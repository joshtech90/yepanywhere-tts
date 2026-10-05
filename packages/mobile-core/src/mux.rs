//! Physical relay ownership is independent of authenticated source ownership.
use crate::{
    Error, Result, check,
    crypto::MAX_BYTES,
    wire::{Socket, open_socket},
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, OnceLock, Weak,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Notify, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;
use url::Url;

const QUEUED_BYTES: usize = 64 * 1024 * 1024;
struct Frame {
    bytes: Vec<u8>,
    binary: bool,
    budget: Arc<AtomicUsize>,
}
impl Drop for Frame {
    fn drop(&mut self) {
        self.budget.fetch_sub(self.bytes.len(), Ordering::AcqRel);
    }
}
fn reserve(budget: &Arc<AtomicUsize>, bytes: Vec<u8>, binary: bool) -> Result<Frame> {
    budget
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
            n.checked_add(bytes.len()).filter(|n| *n <= QUEUED_BYTES)
        })
        .map_err(|_| Error::Overflow)?;
    Ok(Frame {
        bytes,
        binary,
        budget: budget.clone(),
    })
}
struct Reader {
    incoming: mpsc::Sender<Frame>,
    ready: Option<oneshot::Sender<Result<()>>>,
    cancel: CancellationToken,
    authenticated: Arc<AtomicBool>,
}
struct Write {
    message: Message,
    _budget: Option<Frame>,
    reply: oneshot::Sender<Result<()>>,
}
struct Pool {
    writes: mpsc::Sender<Write>,
    readers: Arc<Mutex<HashMap<u32, Reader>>>,
    cleanup: Arc<Notify>,
    cancel: CancellationToken,
    budget: Arc<AtomicUsize>,
    max_circuits: usize,
    max_frame: usize,
    next_id: AtomicUsize,
}
impl Drop for Pool {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
struct Slot(tokio::sync::Mutex<Weak<Pool>>);
static POOLS: OnceLock<Mutex<HashMap<String, Arc<Slot>>>> = OnceLock::new();

fn pool_slot(url: &Url) -> Result<Arc<Slot>> {
    let key = url.as_str().to_owned();
    {
        let mut slots = POOLS
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| Error::Closed)?;
        slots.retain(|_, slot| {
            // Retain callers that have cloned a slot but have not yet taken
            // its async initialization lock. Otherwise another endpoint
            // can evict it in that gap and create a second physical pool.
            Arc::strong_count(slot) > 1
                || slot
                    .0
                    .try_lock()
                    .map_or(true, |pool| pool.strong_count() > 0)
        });
        if !slots.contains_key(&key) && slots.len() >= 32 {
            return Err(Error::Overflow);
        }
        Ok(slots
            .entry(key)
            .or_insert_with(|| Arc::new(Slot(tokio::sync::Mutex::new(Weak::new()))))
            .clone())
    }
}

pub struct Circuit {
    pool: Arc<Pool>,
    id: u32,
    incoming: mpsc::Receiver<Frame>,
    cancel: CancellationToken,
    authenticated: Arc<AtomicBool>,
}
impl Drop for Circuit {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.pool.cleanup.notify_one();
    }
}
impl Circuit {
    pub fn authenticated(&self) {
        self.authenticated.store(true, Ordering::Release);
    }
    pub async fn connect(url: &Url, target: &str) -> Result<Self> {
        let slot = pool_slot(url)?;
        let mut held = slot.0.lock().await;
        let pool = if let Some(pool) = held.upgrade().filter(|p| !p.cancel.is_cancelled()) {
            pool
        } else {
            let pool = Pool::open(url).await?;
            *held = Arc::downgrade(&pool);
            pool
        };
        let (incoming, rx) = mpsc::channel(32);
        let (ready, wait) = oneshot::channel();
        let cancel = CancellationToken::new();
        let authenticated = Arc::new(AtomicBool::new(false));
        let id = u32::try_from(pool.next_id.fetch_add(1, Ordering::AcqRel))
            .map_err(|_| Error::Overflow)?;
        check(id != 0)?;
        {
            let mut readers = pool.readers.lock().map_err(|_| Error::Closed)?;
            if readers.len() >= pool.max_circuits {
                return Err(Error::Overflow);
            }
            readers.insert(
                id,
                Reader {
                    incoming,
                    ready: Some(ready),
                    cancel: cancel.clone(),
                    authenticated: authenticated.clone(),
                },
            );
        }
        let circuit = Self {
            pool,
            id,
            incoming: rx,
            cancel,
            authenticated,
        };
        // The circuit guard is installed before awaiting so cancellation closes
        // a half-open circuit as well as a fully authenticated one.
        circuit
            .pool
            .write(
                Message::text(
                    json!({"type":"mux_open","circuitId":id,"username":target,"channel":"app"})
                        .to_string(),
                ),
                None,
            )
            .await?;
        tokio::time::timeout(Duration::from_secs(10), wait)
            .await
            .map_err(|_| Error::Timeout)?
            .map_err(|_| Error::Unavailable)??;
        drop(held);
        Ok(circuit)
    }
    pub async fn send(&self, bytes: Vec<u8>, binary: bool) -> Result<()> {
        if self.cancel.is_cancelled() {
            return Err(Error::Unavailable);
        }
        check(bytes.len() + 6 <= self.pool.max_frame)?;
        let frame = reserve(&self.pool.budget, bytes, binary)?;
        let mut envelope = vec![1, u8::from(binary)];
        envelope.extend_from_slice(&self.id.to_be_bytes());
        envelope.extend_from_slice(&frame.bytes);
        self.pool
            .write(Message::Binary(envelope.into()), Some(frame))
            .await
    }
    pub async fn receive(&mut self) -> Result<(Vec<u8>, bool)> {
        tokio::select! {
            biased;
            _ = self.cancel.cancelled() => Err(Error::Unavailable),
            frame = self.incoming.recv() => { let mut frame = frame.ok_or(Error::Unavailable)?;
                let bytes = std::mem::take(&mut frame.bytes);
                // Release accounting before returning ownership to the session.
                frame.budget.fetch_sub(bytes.len(), Ordering::AcqRel);
                Ok((bytes, frame.binary)) }
        }
    }
}
impl Pool {
    async fn open(url: &Url) -> Result<Arc<Self>> {
        let mut endpoint = url.clone();
        endpoint.set_path(&format!("{}/mux", url.path().trim_end_matches("/ws")));
        let mut socket = open_socket(&endpoint, MAX_BYTES + 70).await?;
        let ready = tokio::time::timeout(Duration::from_secs(10), socket.next())
            .await
            .map_err(|_| Error::Timeout)?
            .ok_or(Error::Unavailable)?
            .map_err(|_| Error::Unavailable)?;
        let text = ready.to_text().map_err(|_| Error::InvalidMessage)?;
        check(text.len() <= 65536)?;
        let ready: Value = serde_json::from_str(text)?;
        check(ready["type"] == "mux_ready" && ready["protocolVersion"] == 1)?;
        let max_circuits = ready["maxCircuits"]
            .as_u64()
            .filter(|n| *n > 0)
            .ok_or(Error::InvalidMessage)?
            .min(64) as usize;
        let max_frame = ready["maxFrameBytes"]
            .as_u64()
            .filter(|n| *n >= 65536)
            .ok_or(Error::InvalidMessage)?
            .min((MAX_BYTES + 70) as u64) as usize;
        let (writes, rx) = mpsc::channel(32);
        let pool = Arc::new(Self {
            writes,
            readers: Arc::new(Mutex::new(HashMap::new())),
            cleanup: Arc::new(Notify::new()),
            cancel: CancellationToken::new(),
            budget: Arc::new(AtomicUsize::new(0)),
            max_circuits,
            max_frame,
            next_id: AtomicUsize::new(1),
        });
        tokio::spawn(run(
            socket,
            rx,
            pool.readers.clone(),
            pool.cleanup.clone(),
            pool.cancel.clone(),
            pool.budget.clone(),
            max_frame,
        ));
        Ok(pool)
    }
    async fn write(&self, message: Message, budget: Option<Frame>) -> Result<()> {
        let (reply, wait) = oneshot::channel();
        self.writes
            .try_send(Write {
                message,
                _budget: budget,
                reply,
            })
            .map_err(|_| Error::Overflow)?;
        tokio::select! { _ = self.cancel.cancelled() => Err(Error::Unavailable), r = tokio::time::timeout(Duration::from_secs(10), wait) => r.map_err(|_| Error::Timeout)?.map_err(|_| Error::Unavailable)? }
    }
}
async fn send(socket: &mut Socket, message: Message, cancel: &CancellationToken) -> Result<()> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(Error::Closed),
        result = async {
    tokio::time::timeout(Duration::from_secs(10), socket.send(message))
        .await
        .map_err(|_| Error::Timeout)?
        .map_err(|_| Error::Unavailable)
        } => result,
    }
}
async fn run(
    mut socket: Socket,
    mut writes: mpsc::Receiver<Write>,
    readers: Arc<Mutex<HashMap<u32, Reader>>>,
    cleanup: Arc<Notify>,
    cancel: CancellationToken,
    budget: Arc<AtomicUsize>,
    max_frame: usize,
) {
    let result: Result<()> = async {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = cleanup.notified() => {
                    let removed = { let mut entries = readers.lock().map_err(|_| Error::Closed)?;
                        let ids = entries.iter().filter(|(_, r)| r.cancel.is_cancelled()).map(|(id, _)| *id).collect::<Vec<_>>();
                        for id in &ids { entries.remove(id); } ids };
                    for id in removed { send(&mut socket, Message::text(json!({"type":"mux_close","circuitId":id}).to_string()), &cancel).await?; }
                    if readers.lock().map_err(|_| Error::Closed)?.is_empty() { break; }
                },
                write = writes.recv() => { let Some(write) = write else { break; };
                    if write.reply.is_closed() { continue; }
                    let result = send(&mut socket, write.message, &cancel).await;
                    let failed = result.is_err(); let _ = write.reply.send(result);
                    if failed { return Err(Error::Unavailable); }
                },
                message = socket.next() => {
                    match message.ok_or(Error::Unavailable)?.map_err(|_| Error::Unavailable)? {
                        Message::Ping(bytes) => send(&mut socket, Message::Pong(bytes), &cancel).await?,
                        Message::Pong(_) => {},
                        Message::Close(_) => return Err(Error::Unavailable),
                        Message::Text(text) => {
                            check(text.len() <= 65536)?;
                            let v: Value = serde_json::from_str(&text)?;
                            let id = v["circuitId"].as_u64().and_then(|id| u32::try_from(id).ok()).ok_or(Error::InvalidMessage)?;
                            let mut entries = readers.lock().map_err(|_| Error::Closed)?;
                            if v["type"] == "mux_opened" {
                                if let Some(reader) = entries.get_mut(&id) && let Some(ready) = reader.ready.take() { let _ = ready.send(Ok(())); }
                            } else if matches!(v["type"].as_str(), Some("mux_closed" | "mux_error")) {
                                if let Some(reader) = entries.remove(&id) { reader.cancel.cancel(); }
                                cleanup.notify_one();
                            } else { return Err(Error::InvalidMessage); }
                        },
                        Message::Binary(bytes) => {
                            check(bytes.len() >= 6 && bytes.len() <= max_frame && bytes[0] == 1 && bytes[1] <= 1)?;
                            let id = u32::from_be_bytes(bytes[2..6].try_into().map_err(|_| Error::InvalidMessage)?);
                            let overflow = {
                                let mut entries = readers.lock().map_err(|_| Error::Closed)?;
                                let overflow = if let Some(reader) = entries.get(&id) {
                                    let admitted = reader.authenticated.load(Ordering::Acquire) || bytes.len() <= 65536 + 6;
                                    match if admitted { reserve(&budget, bytes[6..].to_vec(), bytes[1] == 1) } else { Err(Error::Overflow) } {
                                        Ok(frame) => reader.incoming.try_send(frame).is_err(),
                                        Err(_) => true,
                                    }
                                } else { false };
                                if overflow && let Some(reader) = entries.remove(&id) { reader.cancel.cancel(); }
                                overflow
                            };
                            if overflow {
                                send(&mut socket, Message::text(json!({"type":"mux_close","circuitId":id}).to_string()), &cancel).await?;
                                cleanup.notify_one();
                            }
                        },
                        _ => return Err(Error::InvalidMessage),
                    }
                }
            }
        }
        Ok(())
    }.await;
    let _ = result;
    cancel.cancel();
    if let Ok(mut entries) = readers.lock() {
        for (_, reader) in entries.drain() {
            reader.cancel.cancel();
        }
    }
    // Dropping the physical socket releases every queued write and its budget.
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    async fn echo() -> (Url, mpsc::Receiver<u32>, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = Url::parse(&format!("ws://{}/ws", listener.local_addr().unwrap())).unwrap();
        let (closed, rx) = mpsc::channel(64);
        let task = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(socket).await.unwrap();
            socket.send(Message::text(json!({"type":"mux_ready","protocolVersion":1,"maxCircuits":64,"maxFrameBytes":65536}).to_string())).await.unwrap();
            while let Some(Ok(message)) = socket.next().await {
                match message {
                    Message::Text(text) => {
                        let v: Value = serde_json::from_str(&text).unwrap();
                        let id = v["circuitId"].as_u64().unwrap() as u32;
                        if v["type"] == "mux_open" {
                            socket
                                .send(Message::text(
                                    json!({"type":"mux_opened","circuitId":id}).to_string(),
                                ))
                                .await
                                .unwrap();
                        } else if v["type"] == "mux_close" {
                            let _ = closed.send(id).await;
                        }
                    }
                    Message::Binary(bytes) => {
                        if socket.send(Message::Binary(bytes)).await.is_err() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        });
        (url, rx, task)
    }
    #[test]
    fn concurrent_endpoint_lookup_retains_uninitialized_slot() {
        let first_url = Url::parse("ws://pending-alpha.invalid/ws").unwrap();
        let second_url = Url::parse("ws://pending-beta.invalid/ws").unwrap();
        let first = pool_slot(&first_url).unwrap();
        let _other = pool_slot(&second_url).unwrap();
        let same = pool_slot(&first_url).unwrap();
        assert!(Arc::ptr_eq(&first, &same));
    }
    #[tokio::test]
    async fn peers_share_socket_and_final_owner_closes_it() {
        let (url, mut closed, task) = echo().await;
        let a = Circuit::connect(&url, "alpha").await.unwrap();
        let mut b = Circuit::connect(&url, "beta").await.unwrap();
        assert!(Arc::ptr_eq(&a.pool, &b.pool));
        assert_ne!(a.id, b.id);
        let a_id = a.id;
        drop(a);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), closed.recv())
                .await
                .unwrap(),
            Some(a_id)
        );
        b.send(b"healthy peer".to_vec(), false).await.unwrap();
        assert_eq!(
            b.receive().await.unwrap(),
            (b"healthy peer".to_vec(), false)
        );
        drop(b);
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();
    }
    #[tokio::test]
    async fn lagging_circuit_does_not_close_healthy_peer() {
        let (url, mut closed, task) = echo().await;
        let a = Circuit::connect(&url, "slow").await.unwrap();
        let mut b = Circuit::connect(&url, "healthy").await.unwrap();
        for _ in 0..33 {
            a.send(vec![7], true).await.unwrap();
        }
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), closed.recv())
                .await
                .unwrap(),
            Some(a.id)
        );
        assert!(a.cancel.is_cancelled());
        b.send(vec![8], true).await.unwrap();
        assert_eq!(b.receive().await.unwrap(), (vec![8], true));
        drop(a);
        drop(b);
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();
    }
    #[tokio::test]
    async fn physical_failure_notifies_all_circuits() {
        let (url, _, task) = echo().await;
        let mut a = Circuit::connect(&url, "alpha").await.unwrap();
        let mut b = Circuit::connect(&url, "beta").await.unwrap();
        task.abort();
        assert!(
            tokio::time::timeout(Duration::from_secs(2), a.receive())
                .await
                .unwrap()
                .is_err()
        );
        assert!(
            tokio::time::timeout(Duration::from_secs(2), b.receive())
                .await
                .unwrap()
                .is_err()
        );
    }
    #[test]
    fn byte_budget_is_released_on_consumption_and_queue_drop() {
        let budget = Arc::new(AtomicUsize::new(QUEUED_BYTES - 2));
        let frame = reserve(&budget, vec![0; 2], true).unwrap();
        assert!(reserve(&budget, vec![0], true).is_err());
        drop(frame);
        assert_eq!(budget.load(Ordering::Acquire), QUEUED_BYTES - 2);
    }
}
