//! Pull-driven response bodies. A slow reader never stalls the session actor.
use crate::{Error, Result, check};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

pub(crate) const WINDOW: usize = 1024 * 1024;
pub(crate) const CHUNK: usize = 128 * 1024;
pub(crate) const MAX_STREAMS: usize = 8;

pub(crate) struct Slots {
    active: Arc<Semaphore>,
    waiting: AtomicUsize,
}
impl Slots {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Semaphore::new(MAX_STREAMS)),
            waiting: AtomicUsize::new(0),
        }
    }
}
pub(crate) struct Permit {
    _permit: OwnedSemaphorePermit,
}
struct Waiting<'a>(&'a AtomicUsize);
impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
impl Permit {
    pub async fn acquire(slots: &Arc<Slots>) -> Result<Self> {
        slots
            .waiting
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < 64).then_some(n + 1)
            })
            .map_err(|_| Error::Overflow)?;
        let _waiting = Waiting(&slots.waiting);
        let permit = slots
            .active
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Closed)?;
        Ok(Self { _permit: permit })
    }
}

#[derive(Default)]
struct Buffer {
    queue: VecDeque<Vec<u8>>,
    bytes: usize,
    consumed: u64,
    terminal: Option<Result<()>>,
    cancelled: bool,
}
pub(crate) struct Body {
    buffer: Mutex<Buffer>,
    wake: Notify,
    changed: Arc<Notify>,
    pub owner: CancellationToken,
    pub finished: CancellationToken,
}
impl Body {
    pub fn new(changed: Arc<Notify>, owner: CancellationToken) -> Arc<Self> {
        Arc::new(Self {
            buffer: Mutex::new(Buffer::default()),
            wake: Notify::new(),
            changed,
            owner,
            finished: CancellationToken::new(),
        })
    }
    pub fn push(&self, bytes: Vec<u8>) -> Result<()> {
        let mut buffer = self.buffer.lock().map_err(|_| Error::Closed)?;
        if buffer.cancelled {
            return Ok(());
        }
        check(!bytes.is_empty() && bytes.len() <= CHUNK && buffer.terminal.is_none())?;
        if buffer.bytes + bytes.len() > WINDOW {
            return Err(Error::Overflow);
        }
        buffer.bytes += bytes.len();
        buffer.queue.push_back(bytes);
        self.wake.notify_one();
        Ok(())
    }
    pub fn progress(&self) -> Result<(bool, u64)> {
        let buffer = self.buffer.lock().map_err(|_| Error::Closed)?;
        Ok((
            buffer.cancelled || self.owner.is_cancelled(),
            buffer.consumed,
        ))
    }
    pub fn finish(&self, result: Result<()>) {
        if let Ok(mut buffer) = self.buffer.lock()
            && buffer.terminal.is_none()
        {
            if result.is_err() {
                buffer.queue.clear();
                buffer.bytes = 0;
            }
            buffer.terminal = Some(result);
        }
        self.finished.cancel();
        self.wake.notify_one();
    }
    pub fn cancel(&self) {
        if let Ok(mut buffer) = self.buffer.lock() {
            buffer.cancelled = true;
            buffer.queue.clear();
            buffer.bytes = 0;
            buffer.terminal = Some(Err(Error::Closed));
        }
        self.finished.cancel();
        self.changed.notify_one();
        self.wake.notify_one();
    }
    async fn read(&self) -> Result<Option<Vec<u8>>> {
        loop {
            let wake = self.wake.notified();
            tokio::pin!(wake);
            wake.as_mut().enable();
            if self.owner.is_cancelled() {
                self.cancel();
                return Err(Error::Closed);
            }
            {
                let mut buffer = self.buffer.lock().map_err(|_| Error::Closed)?;
                if let Some(bytes) = buffer.queue.pop_front() {
                    buffer.bytes -= bytes.len();
                    buffer.consumed += bytes.len() as u64;
                    self.changed.notify_one();
                    return Ok(Some(bytes));
                }
                if let Some(terminal) = &buffer.terminal {
                    return terminal.clone().map(|()| None);
                }
            }
            tokio::select! { _ = self.owner.cancelled() => { self.cancel(); return Err(Error::Closed); }, _ = wake => {} }
        }
    }
}

/// Status/headers arrive before the body. Bytes cross FFI without JSON/base64.
#[derive(uniffi::Object)]
pub struct NativeResponseStream {
    pub(crate) head: String,
    pub(crate) body: Arc<Body>,
    pub(crate) reader: tokio::sync::Mutex<()>,
    pub(crate) permit: Mutex<Option<Permit>>,
}
impl Drop for NativeResponseStream {
    fn drop(&mut self) {
        self.body.cancel();
    }
}
#[uniffi::export(async_runtime = "tokio")]
impl NativeResponseStream {
    pub fn metadata(&self) -> String {
        self.head.clone()
    }
    pub async fn next_chunk(&self) -> Result<Option<Vec<u8>>> {
        let _reader = self.reader.lock().await;
        let result = self.body.read().await;
        if !matches!(&result, Ok(Some(_))) {
            self.permit.lock().map_err(|_| Error::Closed)?.take();
        }
        result
    }
    pub fn cancel(&self) {
        self.body.cancel();
        if let Ok(mut permit) = self.permit.lock() {
            permit.take();
        }
    }
}

pub(crate) struct Admission(pub Option<Arc<Body>>);
impl Drop for Admission {
    fn drop(&mut self) {
        if let Some(body) = &self.0 {
            body.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancellation_and_consumed_eof_return_slots_before_object_destruction() {
        let slots = Arc::new(Slots::new());
        let body = Body::new(Arc::new(Notify::new()), CancellationToken::new());
        body.push(vec![1]).unwrap();
        body.finish(Ok(()));
        let stream = NativeResponseStream {
            head: String::new(),
            body,
            reader: tokio::sync::Mutex::new(()),
            permit: Mutex::new(Some(Permit::acquire(&slots).await.unwrap())),
        };
        assert_eq!(stream.next_chunk().await.unwrap(), Some(vec![1]));
        assert_eq!(slots.active.available_permits(), MAX_STREAMS - 1);
        assert_eq!(stream.next_chunk().await.unwrap(), None);
        assert_eq!(slots.active.available_permits(), MAX_STREAMS);
        let cancelled = NativeResponseStream {
            head: String::new(),
            body: Body::new(Arc::new(Notify::new()), CancellationToken::new()),
            reader: tokio::sync::Mutex::new(()),
            permit: Mutex::new(Some(Permit::acquire(&slots).await.unwrap())),
        };
        cancelled.cancel();
        assert_eq!(slots.active.available_permits(), MAX_STREAMS);
        assert!(matches!(cancelled.next_chunk().await, Err(Error::Closed)));
        drop((stream, cancelled));
        assert_eq!(slots.active.available_permits(), MAX_STREAMS);
    }
    #[tokio::test]
    async fn slow_reader_is_bounded_and_owner_cancellation_wakes_a_blocked_read() {
        let owner = CancellationToken::new();
        let body = Body::new(Arc::new(Notify::new()), owner.clone());
        for _ in 0..WINDOW / CHUNK {
            body.push(vec![1; CHUNK]).unwrap();
        }
        assert!(matches!(body.push(vec![1]), Err(Error::Overflow)));
        assert_eq!(body.progress().unwrap(), (false, 0));
        for _ in 0..WINDOW / CHUNK {
            assert_eq!(body.read().await.unwrap().unwrap().len(), CHUNK);
        }
        assert_eq!(body.progress().unwrap(), (false, WINDOW as u64));
        let waiting = {
            let body = body.clone();
            tokio::spawn(async move { body.read().await })
        };
        owner.cancel();
        assert!(matches!(waiting.await.unwrap(), Err(Error::Closed)));
    }
    #[tokio::test]
    async fn failed_body_never_reports_a_successful_short_eof() {
        let body = Body::new(Arc::new(Notify::new()), CancellationToken::new());
        body.push(vec![1]).unwrap();
        body.finish(Err(Error::Unavailable));
        assert!(matches!(body.read().await, Err(Error::Unavailable)));
        let slots = Arc::new(Slots::new());
        let mut permits = Vec::new();
        for _ in 0..MAX_STREAMS {
            permits.push(Permit::acquire(&slots).await.unwrap());
        }
        let pending = Permit::acquire(&slots);
        tokio::pin!(pending);
        assert!(futures_util::poll!(&mut pending).is_pending());
        permits.pop();
        let admitted = pending.await.unwrap();
        drop((permits, admitted));
        assert_eq!(slots.active.available_permits(), MAX_STREAMS);
    }
}
