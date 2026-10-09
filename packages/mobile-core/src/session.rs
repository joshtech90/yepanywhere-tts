use crate::{Error, Result, check, crypto::*, parse, wire::Wire};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::Read,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{Mutex, mpsc, oneshot},
    time::{Instant, timeout},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone, uniffi::Record)]
pub struct SessionOptions {
    pub endpoint: String,
    pub relay_target: Option<String>,
    pub username: String,
}
/// Saved native route metadata. Ordering expresses the preferred route first,
/// followed by direct and then relay candidates; reachability grants no authority.
#[derive(Clone, uniffi::Record)]
pub struct NativeRoute {
    pub route_id: String,
    pub endpoint: String,
    pub relay_target: Option<String>,
}
impl NativeRoute {
    fn options(&self, username: &str) -> SessionOptions {
        SessionOptions {
            endpoint: self.endpoint.clone(),
            relay_target: self.relay_target.clone(),
            username: username.into(),
        }
    }
}
#[derive(Serialize, Deserialize)]
struct Credential {
    username: String,
    session_id: String,
    base_key: Vec<u8>,
    resume_protocol_version: u64,
}
impl Drop for Credential {
    fn drop(&mut self) {
        self.base_key.zeroize();
    }
}
struct Secure {
    wire: Wire,
    nonce: String,
    key: Zeroizing<Vec<u8>>,
    outbound: u64,
    inbound: Option<u64>,
}
impl Secure {
    async fn send(&mut self, v: &Value) -> Result<()> {
        let value = json!({"seq":self.outbound,"msg":v});
        self.outbound = self.outbound.checked_add(1).ok_or(Error::Overflow)?;
        let mut bytes = vec![1];
        bytes.extend_from_slice(&serde_json::to_vec(&value)?);
        self.wire.encrypted_send(&bytes, &self.key).await
    }
    async fn receive(&mut self) -> Result<Value> {
        let plain = self.wire.encrypted_receive(&self.key).await?;
        let payload = match plain.first() {
            Some(1) => Zeroizing::new(plain[1..].to_vec()),
            Some(3) => {
                let mut out = Zeroizing::new(Vec::new());
                flate2::read::GzDecoder::new(&plain[1..])
                    .take((MAX_BYTES + 1) as u64)
                    .read_to_end(&mut out)
                    .map_err(|_| Error::InvalidMessage)?;
                check(out.len() <= MAX_BYTES)?;
                out
            }
            _ => return Err(Error::InvalidMessage),
        };
        let v: Value = serde_json::from_slice(&payload)?;
        let seq = v["seq"].as_u64().ok_or(Error::InvalidMessage)?;
        check(
            v.as_object().is_some_and(|o| o.len() == 2)
                && self.inbound.is_none_or(|prev| seq > prev),
        )?;
        self.inbound = Some(seq);
        Ok(v["msg"].clone())
    }
}
fn validate(options: &SessionOptions) -> Result<()> {
    check(options.endpoint.len() <= 2048 && (3..=128).contains(&options.username.len()))
}
async fn establish(wire: Wire, credential: &Credential, nonce: &str) -> Result<Secure> {
    let wire = wire.authenticated().await;
    let key = transport_key(&credential.base_key, &unb64(nonce)?)?;
    let mut secure = Secure {
        wire,
        nonce: nonce.to_owned(),
        key,
        outbound: 0,
        inbound: None,
    };
    secure
        .send(&json!({"type":"client_capabilities","formats":[1]}))
        .await?;
    Ok(secure)
}
pub async fn login(
    options: SessionOptions,
    password: Zeroizing<String>,
    storage: Option<Arc<dyn crate::CredentialPersistence>>,
) -> Result<Arc<NativeSession>> {
    validate(&options)?;
    check(!password.is_empty() && password.len() <= 4096)?;
    let mut wire = Wire::connect(&options.endpoint, options.relay_target.as_deref()).await?;
    wire.plain_send(&json!({"type":"srp_hello","identity":options.username}))
        .await?;
    let challenge = wire.plain_receive().await?;
    check(challenge["type"] == "srp_challenge")?;
    let proof = SrpProof::challenge(
        password.as_bytes(),
        field(&challenge, "salt")?,
        field(&challenge, "B")?,
    )?;
    drop(password);
    wire.plain_send(&json!({"type":"srp_proof","A":proof.a,"M1":proof.m1}))
        .await?;
    let verified = wire.plain_receive().await?;
    check(verified["type"] == "srp_verify")?;
    let base = proof.verify(field(&verified, "M2")?)?;
    let id = field(&verified, "sessionId")?;
    check(!id.is_empty() && id.len() <= 128)?;
    let nonce = field(&verified, "transportNonce")?;
    let info = json_open(field(&verified, "serverInfoProof")?, &base)?;
    check(
        info["type"] == "srp_verify_server_info"
            && info["sessionId"] == id
            && info["transportNonce"] == nonce,
    )?;
    let version = info["resumeProtocolVersion"]
        .as_u64()
        .ok_or(Error::InvalidMessage)?;
    check(version >= 3)?;
    let credential = Credential {
        username: options.username.clone(),
        session_id: id.into(),
        base_key: base.to_vec(),
        resume_protocol_version: version,
    };
    persist(&storage, &credential)?;
    let secure = establish(wire, &credential, nonce).await?;
    Ok(NativeSession::start(
        options, credential, secure, storage, None,
    ))
}
fn persist(
    storage: &Option<Arc<dyn crate::CredentialPersistence>>,
    credential: &Credential,
) -> Result<()> {
    if let Some(storage) = storage
        && !storage.persist(serde_json::to_vec(credential)?)
    {
        return Err(Error::Unavailable);
    }
    Ok(())
}
struct ResumeRecovery {
    storage: Option<Arc<dyn crate::CredentialPersistence>>,
    backup: Zeroizing<Vec<u8>>,
    verified: std::sync::atomic::AtomicBool,
}
impl Drop for ResumeRecovery {
    fn drop(&mut self) {
        // Cancellation before a verified proof has learned no new version.
        // Restore the existing credential when storage is available. After a
        // verified proof, only the newly persisted pin may survive teardown.
        if !self.verified.load(std::sync::atomic::Ordering::Acquire)
            && let Some(storage) = &self.storage
        {
            let _ = storage.persist(self.backup.to_vec());
        }
    }
}
async fn resume_secure(
    options: &SessionOptions,
    credential: &mut Credential,
    storage: &Option<Arc<dyn crate::CredentialPersistence>>,
) -> Result<Secure> {
    if let Some(storage) = storage
        && !storage.begin_resume()
    {
        return Err(Error::Unavailable);
    }
    let recovery = ResumeRecovery {
        storage: storage.clone(),
        backup: Zeroizing::new(serde_json::to_vec(credential)?),
        verified: std::sync::atomic::AtomicBool::new(false),
    };
    let result = resume_proof(options, credential, storage, &recovery.verified).await;
    // Even failure after a valid higher-version proof retains its high-water.
    // Cancellation before proof restores only the existing trusted credential.
    if result.is_err() {
        persist(storage, credential)?;
    }
    result
}
async fn resume_proof(
    options: &SessionOptions,
    credential: &mut Credential,
    storage: &Option<Arc<dyn crate::CredentialPersistence>>,
    verified: &std::sync::atomic::AtomicBool,
) -> Result<Secure> {
    let mut wire = Wire::connect(&options.endpoint, options.relay_target.as_deref()).await?;
    let client_nonce = b64(&random(24)?);
    wire.plain_send(&json!({"type":"srp_resume_init","identity":credential.username,"sessionId":credential.session_id,"clientNonce":client_nonce})).await?;
    let challenge = wire.plain_receive().await?;
    check(
        challenge["type"] == "srp_resume_challenge"
            && challenge["sessionId"] == credential.session_id,
    )?;
    let nonce = field(&challenge, "nonce")?;
    check(unb64(nonce)?.len() == 24)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::InvalidMessage)?
        .as_millis() as u64;
    let proof = json_seal(
        &json!({"timestamp":timestamp,"challenge":nonce,"sessionId":credential.session_id}),
        &credential.base_key,
    )?;
    wire.plain_send(&json!({"type":"srp_resume","identity":credential.username,"sessionId":credential.session_id,"proof":proof})).await?;
    let resumed = wire.plain_receive().await?;
    check(
        resumed["type"] == "srp_resumed"
            && resumed["sessionId"] == credential.session_id
            && resumed["transportNonce"] == nonce,
    )?;
    let proof = json_open(field(&resumed, "serverProof")?, &credential.base_key)?;
    check(
        proof["type"] == "srp_resume_server_proof"
            && proof["sessionId"] == credential.session_id
            && proof["serverNonce"] == nonce
            && proof["clientNonce"] == client_nonce
            && proof["resumeProtocolVersion"]
                .as_u64()
                .is_some_and(|v| v >= credential.resume_protocol_version),
    )?;
    credential.resume_protocol_version = proof["resumeProtocolVersion"]
        .as_u64()
        .ok_or(Error::InvalidMessage)?;
    verified.store(true, std::sync::atomic::Ordering::Release);
    persist(storage, credential)?;
    establish(wire, credential, nonce).await
}
pub async fn resume(
    options: SessionOptions,
    data: &[u8],
    storage: Option<Arc<dyn crate::CredentialPersistence>>,
) -> Result<Arc<NativeSession>> {
    validate(&options)?;
    check(data.len() <= 4096)?;
    let mut credential: Credential = serde_json::from_slice(data)?;
    check(
        credential.username == options.username
            && credential.base_key.len() == 32
            && !credential.session_id.is_empty()
            && credential.session_id.len() <= 128
            && credential.resume_protocol_version >= 3,
    )?;
    let secure = resume_secure(&options, &mut credential, &storage).await?;
    Ok(NativeSession::start(
        options, credential, secure, storage, None,
    ))
}
pub(crate) fn validate_routes(routes: &[NativeRoute], username: &str) -> Result<()> {
    check(!routes.is_empty() && routes.len() <= 16)?;
    let mut ids = std::collections::HashSet::new();
    for route in routes {
        check(
            !route.route_id.is_empty()
                && route.route_id.len() <= 128
                && ids.insert(route.route_id.clone()),
        )?;
        validate(&route.options(username))?;
    }
    Ok(())
}
pub async fn resume_routes(
    mut routes: Vec<NativeRoute>,
    username: String,
    data: &[u8],
    storage: Arc<dyn crate::CredentialPersistence>,
) -> Result<Arc<NativeSession>> {
    check(data.len() <= 4096)?;
    validate_routes(&routes, &username)?;
    let mut credential: Credential = serde_json::from_slice(data)?;
    check(
        credential.username == username
            && credential.base_key.len() == 32
            && !credential.session_id.is_empty()
            && credential.session_id.len() <= 128
            && credential.resume_protocol_version >= 3,
    )?;
    let storage = Some(storage);
    routes[1..].sort_by_key(|route| route.relay_target.is_some());
    let secure = resume_candidates(&mut routes, &mut credential, &storage).await?;
    let options = routes[0].options(&username);
    Ok(NativeSession::start(
        options,
        credential,
        secure,
        storage,
        Some(routes),
    ))
}
async fn resume_candidates(
    routes: &mut Vec<NativeRoute>,
    credential: &mut Credential,
    storage: &Option<Arc<dyn crate::CredentialPersistence>>,
) -> Result<Secure> {
    let mut rejected = 0;
    let mut invalid = false;
    for index in 0..routes.len() {
        match resume_secure(
            &routes[index].options(&credential.username),
            credential,
            storage,
        )
        .await
        {
            Ok(secure) => {
                let preferred = routes.remove(index);
                routes.sort_by_key(|route| route.relay_target.is_some());
                routes.insert(0, preferred);
                return Ok(secure);
            }
            Err(Error::ReauthenticationRequired) => rejected += 1,
            Err(Error::InvalidMessage) => invalid = true,
            Err(_) => {}
        }
    }
    if invalid {
        Err(Error::InvalidMessage)
    } else if rejected == routes.len() {
        Err(Error::ReauthenticationRequired)
    } else {
        Err(Error::Unavailable)
    }
}
enum Command {
    Dispatch(String, Value, oneshot::Sender<Result<String>>),
    Upload(Vec<u8>, oneshot::Sender<Result<()>>),
}
#[derive(Clone, uniffi::Record)]
pub struct NativeSecurityBinding {
    pub session_id: String,
    pub transport_nonce: String,
}
struct Lease {
    route_id: std::sync::Mutex<String>,
    cancel: CancellationToken,
    binding: std::sync::Mutex<NativeSecurityBinding>,
    events: std::sync::Mutex<crate::events::Events>,
    lagged: std::sync::Mutex<HashMap<String, String>>,
    wake: tokio::sync::Notify,
    requests_changed: Arc<tokio::sync::Notify>,
    credential: std::sync::Mutex<Zeroizing<Vec<u8>>>,
}
#[derive(uniffi::Object)]
pub struct NativeSession {
    commands: mpsc::Sender<Command>,
    event_reader: Mutex<()>,
    lease: Arc<Lease>,
}
impl Drop for NativeSession {
    fn drop(&mut self) {
        self.lease.cancel.cancel();
    }
}
impl NativeSession {
    pub fn close(&self) {
        self.shutdown();
    }
    fn start(
        options: SessionOptions,
        credential: Credential,
        secure: Secure,
        storage: Option<Arc<dyn crate::CredentialPersistence>>,
        routes: Option<Vec<NativeRoute>>,
    ) -> Arc<Self> {
        let (commands, rx) = mpsc::channel(32);

        let lease = Arc::new(Lease {
            route_id: std::sync::Mutex::new(
                routes
                    .as_ref()
                    .map_or(String::new(), |r| r[0].route_id.clone()),
            ),
            cancel: CancellationToken::new(),
            binding: std::sync::Mutex::new(NativeSecurityBinding {
                session_id: credential.session_id.clone(),
                transport_nonce: secure.nonce.clone(),
            }),
            events: std::sync::Mutex::new(crate::events::Events::default()),
            lagged: std::sync::Mutex::new(HashMap::new()),
            wake: tokio::sync::Notify::new(),
            requests_changed: Arc::new(tokio::sync::Notify::new()),
            credential: std::sync::Mutex::new(Zeroizing::new(
                serde_json::to_vec(&credential).expect("serializable credential"),
            )),
        });
        let session = Arc::new(Self {
            commands,
            event_reader: Mutex::new(()),
            lease: lease.clone(),
        });
        tokio::spawn(async move {
            let mut actor = Actor::new(options, credential, secure, rx, lease, storage);
            if let Some(routes) = routes {
                actor.routes = routes;
            }
            actor.run().await;
        });
        session
    }
}
#[uniffi::export(async_runtime = "tokio")]
impl NativeSession {
    pub fn route_id(&self) -> Result<String> {
        if self.lease.cancel.is_cancelled() {
            return Err(Error::Closed);
        }
        Ok(self
            .lease
            .route_id
            .lock()
            .map_err(|_| Error::Closed)?
            .clone())
    }
    pub fn credential_data(&self) -> Result<Vec<u8>> {
        if self.lease.cancel.is_cancelled() {
            return Err(Error::Closed);
        }
        let credential = self.lease.credential.lock().map_err(|_| Error::Closed)?;
        if self.lease.cancel.is_cancelled() {
            return Err(Error::Closed);
        }
        Ok(credential.to_vec())
    }
    pub fn security_binding(&self) -> Result<NativeSecurityBinding> {
        if self.lease.cancel.is_cancelled() {
            return Err(Error::Closed);
        }
        Ok(self
            .lease
            .binding
            .lock()
            .map_err(|_| Error::Closed)?
            .clone())
    }
    pub fn shutdown(&self) {
        self.lease.cancel.cancel();
        if let Ok(mut events) = self.lease.events.lock() {
            *events = crate::events::Events::default();
        }
        if let Ok(mut credential) = self.lease.credential.lock() {
            credential.zeroize();
        }
    }
    pub async fn dispatch(&self, method: String, params: String) -> Result<String> {
        if self.lease.cancel.is_cancelled() {
            return Err(Error::Closed);
        }
        let params = parse(&params, 512 * 1024)?;
        let _cleanup = RequestCleanup(self.lease.requests_changed.clone());
        let (tx, rx) = oneshot::channel();
        self.commands
            .try_send(Command::Dispatch(method, params, tx))
            .map_err(|_| Error::Overflow)?;
        tokio::select! { _ = self.lease.cancel.cancelled() => Err(Error::Closed), result = timeout(Duration::from_secs(30), rx) => result.map_err(|_| Error::Timeout)?.map_err(|_| Error::Closed)? }
    }
    pub async fn upload_chunk(&self, payload: Vec<u8>) -> Result<()> {
        check(payload.len() >= 24 && payload.len() <= 65536 + 24)?;
        let (tx, rx) = oneshot::channel();
        self.commands
            .try_send(Command::Upload(payload, tx))
            .map_err(|_| Error::Overflow)?;
        tokio::select! { _ = self.lease.cancel.cancelled() => Err(Error::Closed), result = timeout(Duration::from_secs(30), rx) => result.map_err(|_| Error::Timeout)?.map_err(|_| Error::Closed)? }
    }
    pub async fn next_event(&self) -> Result<String> {
        let _reader = self.event_reader.lock().await;
        loop {
            let wake = self.lease.wake.notified();
            tokio::pin!(wake);
            wake.as_mut().enable();
            {
                let mut lagged = self.lease.lagged.lock().map_err(|_| Error::Closed)?;
                if let Some(id) = lagged.keys().next().cloned() {
                    return lagged.remove(&id).ok_or(Error::Closed);
                }
            }
            if let Some(value) = self.lease.events.lock().map_err(|_| Error::Closed)?.pop() {
                return Ok(value);
            }
            if self.lease.cancel.is_cancelled() {
                return Err(Error::Closed);
            }
            tokio::select! { _ = self.lease.cancel.cancelled() => return Err(Error::Closed), _ = wake => continue }
        }
    }
}
struct RequestCleanup(Arc<tokio::sync::Notify>);
impl Drop for RequestCleanup {
    fn drop(&mut self) {
        self.0.notify_one();
    }
}
struct Pending {
    reply: oneshot::Sender<Result<String>>,
    deadline: Instant,
}
struct Upload {
    wire_id: Uuid,
    offset: u64,
    size: u64,
}
struct Actor {
    routes: Vec<NativeRoute>,
    options: SessionOptions,
    credential: Credential,
    secure: Secure,
    commands: mpsc::Receiver<Command>,
    retired: Vec<String>,
    lease: Arc<Lease>,
    storage: Option<Arc<dyn crate::CredentialPersistence>>,
    pending: HashMap<String, Pending>,
    subscriptions: HashMap<String, Value>,
    uploads: HashMap<String, Upload>,
}
impl Actor {
    fn new(
        options: SessionOptions,
        credential: Credential,
        secure: Secure,
        commands: mpsc::Receiver<Command>,
        lease: Arc<Lease>,
        storage: Option<Arc<dyn crate::CredentialPersistence>>,
    ) -> Self {
        Self {
            routes: vec![NativeRoute {
                route_id: String::new(),
                endpoint: options.endpoint.clone(),
                relay_target: options.relay_target.clone(),
            }],
            options,
            credential,
            secure,
            commands,
            retired: Vec::new(),
            lease,
            storage,
            pending: HashMap::new(),
            subscriptions: HashMap::new(),
            uploads: HashMap::new(),
        }
    }
    fn retire_subscription(&mut self, id: String, error: Value) -> Result<()> {
        self.subscriptions.remove(&id);
        self.lease
            .events
            .lock()
            .map_err(|_| Error::Closed)?
            .remove_owner(&id);
        let detail = error
            .get("error")
            .filter(|value| value.to_string().len() <= 2048)
            .cloned()
            .unwrap_or(json!("Native subscription failed"));
        let mut bounded = json!({"type":"subscriptionError","subscriptionId":id,"error":detail});
        if let Some(code) = error.get("errorCode").and_then(Value::as_str) {
            bounded["errorCode"] = json!(code);
        } else if let Some(status) = error["status"]
            .as_u64()
            .filter(|status| (400..=599).contains(status))
        {
            bounded["status"] = json!(status);
        }
        self.lease
            .lagged
            .lock()
            .map_err(|_| Error::Closed)?
            .insert(id.clone(), bounded.to_string());
        self.retired.push(id);
        self.lease.wake.notify_one();
        Ok(())
    }
    fn event(&mut self, v: Value) -> Result<()> {
        let retired = self
            .lease
            .events
            .lock()
            .map_err(|_| Error::Closed)?
            .push(&v)?;
        for id in retired {
            self.retire_subscription(id.clone(), json!({"type":"subscriptionError","subscriptionId":id,"errorCode":"OVERFLOW","error":"Native subscription consumer fell behind"}))?;
        }
        self.lease.wake.notify_one();
        Ok(())
    }
    fn fail_pending(&mut self) {
        for (_, p) in self.pending.drain() {
            let _ = p.reply.send(Err(Error::Unavailable));
        }
        let ids = self.uploads.drain().map(|(id, _)| id).collect::<Vec<_>>();
        for id in ids {
            let _ = self.event(
                json!({"type":"upload_error","uploadId":id,"error":"Connection interrupted"}),
            );
        }
    }
    async fn reconnect(&mut self) -> Result<()> {
        self.fail_pending();
        let conversations = self
            .subscriptions
            .iter()
            .filter(|(_, p)| p["channel"] == "/api/experimental/conversation/subscribe")
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in conversations {
            self.retire_subscription(
                id,
                json!({"errorCode":"CONNECTION_UNAVAILABLE","error":"Conversation connection interrupted"}),
            )?;
        }
        self.event(json!({"type":"state","phase":"RETRYING"}))?;
        for delay in [250, 1000, 3000] {
            tokio::select! { _ = self.lease.cancel.cancelled() => return Err(Error::Closed), _ = tokio::time::sleep(Duration::from_millis(delay)) => {} }
            let result = tokio::select! { _ = self.lease.cancel.cancelled() => return Err(Error::Closed), r = resume_candidates(&mut self.routes, &mut self.credential, &self.storage) => r };
            match result {
                Ok(secure) => {
                    if self.lease.cancel.is_cancelled() {
                        return Err(Error::Closed);
                    }
                    self.secure = secure;
                    self.options = self.routes[0].options(&self.credential.username);
                    *self.lease.route_id.lock().map_err(|_| Error::Closed)? =
                        self.routes[0].route_id.clone();
                    *self.lease.binding.lock().map_err(|_| Error::Closed)? =
                        NativeSecurityBinding {
                            session_id: self.credential.session_id.clone(),
                            transport_nonce: self.secure.nonce.clone(),
                        };
                    {
                        let mut exported =
                            self.lease.credential.lock().map_err(|_| Error::Closed)?;
                        if self.lease.cancel.is_cancelled() {
                            return Err(Error::Closed);
                        }
                        *exported = Zeroizing::new(serde_json::to_vec(&self.credential)?);
                    }
                    let cancel = self.lease.cancel.clone();
                    let mut restored = true;
                    for subscription in self.subscriptions.values() {
                        let result = tokio::select! { _ = cancel.cancelled() => return Err(Error::Closed), r = self.secure.send(subscription) => r };
                        if result.is_err() {
                            restored = false;
                            break;
                        }
                    }
                    if !restored {
                        continue;
                    }
                    self.event(json!({"type":"state","phase":"CONNECTED","routeId":self.routes[0].route_id}))?;
                    return Ok(());
                }
                Err(error @ (Error::ReauthenticationRequired | Error::InvalidMessage)) => {
                    return Err(error);
                }
                Err(_) => {}
            }
        }
        Err(Error::Unavailable)
    }
    async fn run(mut self) {
        loop {
            let deadline = self.pending.values().map(|p| p.deadline).min();
            let cleanup = async {
                if let Some(deadline) = deadline {
                    tokio::time::sleep_until(deadline).await;
                } else {
                    std::future::pending::<()>().await;
                }
            };
            let outcome = tokio::select! {
                biased;
                _ = self.lease.cancel.cancelled() => break,
                command = self.commands.recv() => match command { Some(c) => {
                    let cancel = self.lease.cancel.clone();
                    tokio::select! { _ = cancel.cancelled() => Err(Error::Closed), result = self.command(c) => result }
                }, None => break },
                _ = self.lease.requests_changed.notified() => {
                    self.pending.retain(|_,p| !p.reply.is_closed()); Ok(())
                },
                _ = cleanup => {
                    self.pending.retain(|_,p| !p.reply.is_closed() && p.deadline > Instant::now()); Ok(())
                },
                message = self.secure.receive() => match message {
                    Ok(v) => {
                        let cancel = self.lease.cancel.clone();
                        tokio::select! { _ = cancel.cancelled() => Err(Error::Closed), result = self.message(v) => result }
                    },
                    Err(Error::InvalidMessage) => Err(Error::InvalidMessage),
                    Err(_) => self.reconnect().await,
                },
            };
            let outcome = if outcome.is_ok() {
                let mut result = Ok(());
                while let Some(id) = self.retired.pop() {
                    let cancel = self.lease.cancel.clone();
                    let unsubscribe = json!({"type":"unsubscribe","subscriptionId":id});
                    result = tokio::select! { _ = cancel.cancelled() => Err(Error::Closed), r = self.secure.send(&unsubscribe) => r };
                    if result.is_err() {
                        result = self.reconnect().await;
                        break;
                    }
                }
                result
            } else {
                outcome
            };
            if let Err(error) = outcome {
                let phase = if matches!(error, Error::ReauthenticationRequired) {
                    "REAUTHENTICATION_REQUIRED"
                } else {
                    "FAILED"
                };
                let recoverable =
                    matches!(error, Error::Unavailable | Error::Timeout | Error::Closed);
                let _ = self.event(json!({"type":"state","phase":phase,"recoverable":recoverable}));
                break;
            }
        }
        self.fail_pending();
        self.lease.cancel.cancel();
        if let Ok(mut credential) = self.lease.credential.lock() {
            credential.zeroize();
        }
        if let Ok(mut binding) = self.lease.binding.lock() {
            binding.session_id.zeroize();
            binding.transport_nonce.zeroize();
        }
        // Drop the socket, keys, queues and subscriptions when its final lease closes.
    }
    async fn command(&mut self, c: Command) -> Result<()> {
        match c {
            Command::Upload(mut payload, reply) => {
                let id = Uuid::from_slice(&payload[..16])
                    .map_err(|_| Error::InvalidMessage)?
                    .to_string();
                let offset = u64::from_be_bytes(
                    payload[16..24]
                        .try_into()
                        .map_err(|_| Error::InvalidMessage)?,
                );
                let Some(upload) = self.uploads.get_mut(&id) else {
                    let _ = reply.send(Err(Error::InvalidMessage));
                    return Ok(());
                };
                if offset != upload.offset || offset + (payload.len() - 24) as u64 > upload.size {
                    let _ = reply.send(Err(Error::InvalidMessage));
                    return Ok(());
                }
                upload.offset += (payload.len() - 24) as u64;
                payload[..16].copy_from_slice(upload.wire_id.as_bytes());
                let mut inner = vec![2];
                inner.extend_from_slice(&payload);
                let result = self
                    .secure
                    .wire
                    .encrypted_send(&inner, &self.secure.key)
                    .await;
                let failed = result.is_err();
                let _ = reply.send(result);
                if failed {
                    self.reconnect().await?;
                }
            }
            Command::Dispatch(method, mut p, mut reply) => {
                if reply.is_closed() {
                    return Ok(());
                }
                self.pending.retain(|_, p| !p.reply.is_closed());
                if self.pending.len() >= 32 {
                    let _ = reply.send(Err(Error::Overflow));
                    return Ok(());
                }
                let result: Result<Option<String>> = tokio::select! {
                    _ = reply.closed() => Err(Error::Closed),
                    result = async {
                    match method.as_str() {
                        "request" => {
                            let path = field(&p, "path")?;
                            check(
                                path.starts_with('/')
                                    && !path.starts_with("//")
                                    && path.len() <= 4096,
                            )?;
                            check(matches!(
                                field(&p, "method")?,
                                "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
                            ))?;
                            let id = Uuid::new_v4().to_string();
                            p["id"] = json!(id);
                            p["type"] = json!("request");
                            self.secure.send(&p).await?;
                            Ok(Some(id))
                        }
                        "subscribe" => {
                            check(
                                self.subscriptions.len()
                                    + self.lease.lagged.lock().map_err(|_| Error::Closed)?.len()
                                    < 64,
                            )?;
                            let id = field(&p, "subscriptionId")?.to_owned();
                            check(
                                !id.is_empty()
                                    && id.len() <= 128
                                    && !self.subscriptions.contains_key(&id),
                            )?;
                            p["type"] = json!("subscribe");
                            self.secure.send(&p).await?;
                            self.subscriptions.insert(id, p);
                            Ok(None)
                        }
                        "unsubscribe" => {
                            let id = field(&p, "subscriptionId")?.to_owned();
                            check(self.subscriptions.remove(&id).is_some())?;
                            p["type"] = json!("unsubscribe");
                            self.secure.send(&p).await?;
                            Ok(None)
                        }
                        "uploadStart" => {
                            check(self.uploads.len() < 4)?;
                            let id = field(&p, "uploadId")?.to_owned();
                            let _ = Uuid::parse_str(&id).map_err(|_| Error::InvalidMessage)?;
                            check(
                                !self.uploads.contains_key(&id)
                                    && matches!(
                                        field(&p, "type")?,
                                        "upload_start" | "staged_upload_start"
                                    ),
                            )?;
                            let wire_id = Uuid::new_v4();
                            let size = p["size"].as_u64().ok_or(Error::InvalidMessage)?;
                            check(size <= 100 * 1024 * 1024)?;
                            p["uploadId"] = json!(wire_id.to_string());
                            self.secure.send(&p).await?;
                            self.uploads.insert(
                                id,
                                Upload {
                                    wire_id,
                                    offset: 0,
                                    size,
                                },
                            );
                            Ok(None)
                        }
                        "uploadEnd" | "uploadCancel" => {
                            let id = field(&p, "uploadId")?.to_owned();
                            let upload = self.uploads.get(&id).ok_or(Error::InvalidMessage)?;
                            if method == "uploadEnd" {
                                check(upload.offset == upload.size)?;
                            }
                            p["uploadId"] = json!(upload.wire_id.to_string());
                            p["type"] = json!("upload_end");
                            self.secure.send(&p).await?;
                            if method == "uploadCancel" {
                                self.uploads.remove(&id);
                            }
                            Ok(None)
                        }
                        "reconnect" => {
                            self.reconnect().await?;
                            Ok(None)
                        }
                        _ => Err(Error::InvalidMessage),
                    }
                    } => result,
                };
                if matches!(result, Err(Error::Closed)) {
                    return self.reconnect().await;
                }
                match result {
                    Ok(Some(id)) => {
                        self.pending.insert(
                            id,
                            Pending {
                                reply,
                                deadline: Instant::now() + Duration::from_secs(30),
                            },
                        );
                    }
                    Ok(None) => {
                        let _ = reply.send(Ok("{}".into()));
                    }
                    Err(e) => {
                        let reconnect = matches!(e, Error::Unavailable | Error::Timeout);
                        let _ = reply.send(Err(e));
                        if reconnect {
                            self.reconnect().await?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
    async fn message(&mut self, mut v: Value) -> Result<()> {
        match field(&v, "type")? {
            "response" => {
                if let Some(pending) = self.pending.remove(field(&v, "id")?) {
                    let _ = pending.reply.send(Ok(
                        json!({"status":v["status"],"headers":v["headers"],"body":v["body"]})
                            .to_string(),
                    ));
                } else if let Some(subscription) = self.subscriptions.remove(field(&v, "id")?) {
                    self.event(json!({"type":"subscriptionError","subscriptionId":subscription["subscriptionId"],"status":v["status"],"error":v["body"]}))?;
                }
            }
            "event" | "subscription_error" => {
                let id = field(&v, "subscriptionId")?.to_owned();
                if let Some(subscription) = self.subscriptions.get_mut(&id) {
                    if let Some(event_id) = v.get("eventId") {
                        subscription["lastEventId"] = event_id.clone();
                    }
                    if v["type"] == "subscription_error" {
                        v["type"] = json!("subscriptionError");
                    }
                    if v["type"] == "subscriptionError" {
                        self.retire_subscription(id, v)?;
                    } else {
                        self.event(v)?;
                    }
                }
            }
            "upload_progress" | "upload_complete" | "upload_error" => {
                let wire_id = field(&v, "uploadId")?;
                if let Some(id) = self
                    .uploads
                    .iter()
                    .find(|(_, u)| u.wire_id.to_string() == wire_id)
                    .map(|(id, _)| id.clone())
                {
                    let terminal = v["type"] != "upload_progress";
                    v["uploadId"] = json!(id);
                    if terminal {
                        self.uploads.remove(&id);
                    }
                    self.event(v)?;
                }
            }
            "pong" => {}
            _ => return Err(Error::InvalidMessage),
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, tungstenite::Message};
    pub(crate) fn fixture_credential_data() -> Vec<u8> {
        serde_json::to_vec(&credential()).unwrap()
    }
    fn credential() -> Credential {
        Credential {
            username: "fixture-owner".into(),
            session_id: "public-fixture-session".into(),
            base_key: vec![7; 32],
            resume_protocol_version: 3,
        }
    }
    pub(crate) async fn peer(
        version: u64,
        mutation: &str,
    ) -> (SessionOptions, tokio::task::JoinHandle<()>) {
        peer_observed(version, mutation, None).await
    }
    async fn peer_observed(
        version: u64,
        mutation: &str,
        held: Option<mpsc::Sender<()>>,
    ) -> (SessionOptions, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}/api/ws", listener.local_addr().unwrap());
        let mutation = mutation.to_owned();
        let peer = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(socket).await.unwrap();
            let init: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            let nonce = b64(&[9; 24]);
            socket.send(Message::text(json!({"type":"srp_resume_challenge","sessionId":credential().session_id,"nonce":nonce}).to_string())).await.unwrap();
            let _ = socket.next().await;
            let mut proof = json!({"type":"srp_resume_server_proof","sessionId":credential().session_id,"serverNonce":nonce,"clientNonce":init["clientNonce"],"resumeProtocolVersion":version});
            if mutation == "client-nonce" {
                proof["clientNonce"] = json!(b64(&[8; 24]));
            }
            if mutation == "server-nonce" {
                proof["serverNonce"] = json!(b64(&[8; 24]));
            }
            if mutation == "session" {
                proof["sessionId"] = json!("another-fixture-session");
            }
            let mut envelope = json!({"type":"srp_resumed","sessionId":credential().session_id,"transportNonce":nonce,"serverProof":json_seal(&proof, &credential().base_key).unwrap()});
            if mutation == "missing-proof" {
                envelope.as_object_mut().unwrap().remove("serverProof");
            }
            if mutation == "tampered-proof" {
                envelope["serverProof"] = json!(json_seal(&proof, &[8; 32]).unwrap());
            }
            if mutation == "outer-nonce" {
                envelope["transportNonce"] = json!(b64(&[8; 24]));
            }
            if socket
                .send(Message::text(envelope.to_string()))
                .await
                .is_err()
            {
                return;
            }
            // No application data precedes native client capabilities.
            if !matches!(socket.next().await, Some(Ok(Message::Binary(_)))) {
                return;
            }
            let key = transport_key(&credential().base_key, &[9; 24]).unwrap();
            let mut seq = 0;
            while let Some(Ok(Message::Binary(bytes))) = socket.next().await {
                let plain = open(&bytes[25..], &bytes[1..25], &key).unwrap();
                if plain.first() != Some(&1) {
                    continue;
                }
                let request: Value = serde_json::from_slice(&plain[1..]).unwrap();
                let request = &request["msg"];
                if request["type"] == "request" && request["path"] == "/invalid" {
                    socket
                        .send(Message::text("unauthenticated application data"))
                        .await
                        .unwrap();
                    continue;
                }
                if request["type"] == "request" && request["path"] == "/held" {
                    if let Some(held) = &held {
                        let _ = held.send(()).await;
                    }
                    continue;
                }
                let messages = if request["type"] == "subscribe" {
                    let count = if request["subscriptionId"] == "lagging" {
                        200
                    } else {
                        1
                    };
                    (0..count).map(|i| json!({"type":"event","subscriptionId":request["subscriptionId"],"eventId":i.to_string(),"data":{"kind":"fixture"}})).collect::<Vec<_>>()
                } else if request["type"] == "request" {
                    vec![
                        json!({"type":"response","id":request["id"],"status":200,"headers":{},"body":{"fixture":true}}),
                    ]
                } else {
                    vec![]
                };
                for message in messages {
                    let mut inner = vec![1];
                    inner
                        .extend_from_slice(json!({"seq":seq,"msg":message}).to_string().as_bytes());
                    seq += 1;
                    let mut frame = vec![1];
                    frame.extend_from_slice(&[10; 24]);
                    frame.extend_from_slice(&seal(&inner, &[10; 24], &key).unwrap());
                    if socket.send(Message::binary(frame)).await.is_err() {
                        return;
                    }
                }
            }
        });
        (
            SessionOptions {
                endpoint,
                username: credential().username.clone(),
                relay_target: None,
            },
            peer,
        )
    }
    #[tokio::test]
    async fn failed_proof_is_not_reported_as_network_exhaustion() {
        let (bad, bad_peer) = peer(3, "tampered-proof").await;
        let storage = Arc::new(super::storage_tests::Storage::default());
        let result = resume_routes(
            vec![NativeRoute {
                route_id: "unverified".into(),
                endpoint: bad.endpoint,
                relay_target: None,
            }],
            credential().username.clone(),
            &serde_json::to_vec(&credential()).unwrap(),
            storage,
        )
        .await;
        assert!(matches!(result, Err(Error::InvalidMessage)));
        bad_peer.abort();
        let _ = bad_peer.await;
    }

    #[tokio::test]
    async fn route_fallback_authenticates_saved_identity_and_persists_pin() {
        let (bad, bad_peer) = peer(3, "tampered-proof").await;
        let (good, good_peer) = peer(4, "").await;
        let storage = Arc::new(super::storage_tests::Storage::default());
        let routes = vec![
            NativeRoute {
                route_id: "preferred".into(),
                endpoint: bad.endpoint,
                relay_target: None,
            },
            NativeRoute {
                route_id: "direct-fallback".into(),
                endpoint: good.endpoint,
                relay_target: None,
            },
        ];
        let session = resume_routes(
            routes,
            credential().username.clone(),
            &serde_json::to_vec(&credential()).unwrap(),
            storage.clone(),
        )
        .await
        .unwrap();
        assert_eq!(session.route_id().unwrap(), "direct-fallback");
        let data: Value =
            serde_json::from_slice(storage.saved.lock().unwrap().as_ref().unwrap()).unwrap();
        assert_eq!(data["resume_protocol_version"], 4);
        assert!(
            session
                .dispatch(
                    "request".into(),
                    json!({"method":"GET","path":"/fixture"}).to_string()
                )
                .await
                .unwrap()
                .contains("200")
        );
        session.close();
        bad_peer.abort();
        good_peer.abort();
    }
    #[tokio::test]
    async fn resume_rejects_context_tampering_and_persists_highest_version() {
        let data = serde_json::to_vec(&credential()).unwrap();
        for mutation in [
            "client-nonce",
            "server-nonce",
            "session",
            "missing-proof",
            "tampered-proof",
            "outer-nonce",
        ] {
            let (options, peer) = peer(3, mutation).await;
            assert!(resume(options, &data, None).await.is_err(), "{mutation}");
            peer.abort();
            let _ = peer.await;
        }
        let (options, task) = peer(4, "").await;
        let session = resume(options, &data, None).await.unwrap();
        let advanced = session.credential_data().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&advanced).unwrap()["resume_protocol_version"],
            4
        );
        session.close();
        task.abort();
        let _ = task.await;
        let (options, task) = peer(3, "").await;
        assert!(resume(options, &advanced, None).await.is_err());
        task.abort();
        let _ = task.await;
    }
    #[tokio::test]
    async fn lagging_subscription_preserves_requests_and_other_subscriptions() {
        let (options, task) = peer(3, "").await;
        let session = resume(options, &serde_json::to_vec(&credential()).unwrap(), None)
            .await
            .unwrap();
        session
            .dispatch(
                "subscribe".into(),
                json!({"subscriptionId":"lagging","channel":"activity"}).to_string(),
            )
            .await
            .unwrap();
        assert!(
            session
                .dispatch(
                    "request".into(),
                    json!({"method":"GET","path":"/api/projects"}).to_string()
                )
                .await
                .unwrap()
                .contains("200")
        );
        let error = session.next_event().await.unwrap();
        assert!(
            error.contains("subscriptionError") && error.contains("lagging"),
            "{error}"
        );
        let typed: Value = serde_json::from_str(&error).unwrap();
        assert_eq!(typed["errorCode"], "OVERFLOW");
        assert!(typed.get("status").is_none());
        assert!(
            session
                .dispatch(
                    "unsubscribe".into(),
                    json!({"subscriptionId":"foreign"}).to_string()
                )
                .await
                .is_err()
        );
        session
            .dispatch(
                "subscribe".into(),
                json!({"subscriptionId":"healthy","channel":"activity"}).to_string(),
            )
            .await
            .unwrap();
        let event: Value = serde_json::from_str(&session.next_event().await.unwrap()).unwrap();
        assert_eq!(event["type"], "event");
        assert_eq!(event["subscriptionId"], "healthy");
        session.close();
        assert!(session.credential_data().is_err());
        task.abort();
        let _ = task.await;
    }
    #[tokio::test]
    async fn actor_failure_wakes_event_consumers_and_invalidates_exports() {
        let (options, peer) = peer(3, "").await;
        let session = resume(options, &serde_json::to_vec(&credential()).unwrap(), None)
            .await
            .unwrap();
        assert!(
            session
                .dispatch(
                    "request".into(),
                    json!({"method":"GET","path":"/invalid"}).to_string()
                )
                .await
                .is_err()
        );
        let terminal = timeout(Duration::from_millis(500), session.next_event())
            .await
            .unwrap()
            .unwrap();
        let terminal: Value = serde_json::from_str(&terminal).unwrap();
        assert_eq!(terminal["type"], "state");
        assert_eq!(terminal["phase"], "FAILED");
        assert_eq!(terminal["recoverable"], false);
        assert!(
            timeout(Duration::from_millis(500), session.next_event())
                .await
                .unwrap()
                .is_err()
        );
        assert!(session.credential_data().is_err());
        session.close();
        peer.abort();
        let _ = peer.await;
    }
    #[tokio::test]
    async fn cancelling_requests_releases_pending_slots_without_waiting_for_timeout() {
        let (held, mut received) = mpsc::channel(1);
        let (options, peer) = peer_observed(3, "", Some(held)).await;
        let session = resume(options, &serde_json::to_vec(&credential()).unwrap(), None)
            .await
            .unwrap();
        for _ in 0..40 {
            let source = session.clone();
            let request = tokio::spawn(async move {
                source
                    .dispatch(
                        "request".into(),
                        json!({"method":"GET","path":"/held"}).to_string(),
                    )
                    .await
            });
            timeout(Duration::from_millis(500), received.recv())
                .await
                .unwrap()
                .unwrap();
            request.abort();
            let _ = request.await;
        }
        assert!(
            session
                .dispatch(
                    "request".into(),
                    json!({"method":"GET","path":"/healthy"}).to_string()
                )
                .await
                .unwrap()
                .contains("200")
        );
        session.close();
        peer.abort();
        let _ = peer.await;
    }
    #[tokio::test]
    async fn durable_resume_pin_precedes_consumers_and_storage_failure_invalidates_old_pin() {
        for fail in [false, true] {
            let storage = Arc::new(super::storage_tests::Storage::default());
            *storage.saved.lock().unwrap() = Some(serde_json::to_vec(&credential()).unwrap());
            storage
                .fail
                .store(fail, std::sync::atomic::Ordering::Release);
            let (options, peer) = peer(4, "").await;
            let result = resume(
                options,
                &serde_json::to_vec(&credential()).unwrap(),
                Some(storage.clone()),
            )
            .await;
            if fail {
                assert!(result.is_err());
                assert!(storage.saved.lock().unwrap().is_none());
            } else {
                let session = result.unwrap();
                let saved = storage.saved.lock().unwrap().clone().unwrap();
                assert_eq!(
                    serde_json::from_slice::<Value>(&saved).unwrap()["resume_protocol_version"],
                    4
                );
                // A failing later consumer/continuity operation or teardown cannot
                // roll the stored authenticated version back.
                assert!(
                    session
                        .dispatch("invalid-consumer-operation".into(), "{}".into())
                        .await
                        .is_err()
                );
                session.close();
                assert_eq!(
                    serde_json::from_slice::<Value>(
                        storage.saved.lock().unwrap().as_ref().unwrap()
                    )
                    .unwrap()["resume_protocol_version"],
                    4
                );
            }
            peer.abort();
            let _ = peer.await;
        }
    }
    #[tokio::test]
    async fn close_quiesces_socket_and_erases_exports() {
        let (options, task) = peer(3, "").await;
        let session = resume(options, &serde_json::to_vec(&credential()).unwrap(), None)
            .await
            .unwrap();
        session.close();
        assert!(session.security_binding().is_err());
        assert!(session.credential_data().is_err());
        // Teardown latency is the subject, not a generic test speed budget.
        timeout(Duration::from_millis(500), task)
            .await
            .unwrap()
            .unwrap();
        assert!(
            session
                .lease
                .credential
                .lock()
                .unwrap()
                .iter()
                .all(|x| *x == 0)
        );
    }
    #[tokio::test]
    async fn preauthentication_rejects_oversized_header_without_waiting_for_body() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}/api/ws", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(socket).await.unwrap();
            let _ = socket.next().await;
            let mut header = vec![0x81, 127];
            header.extend_from_slice(&(32_u64 * 1024 * 1024).to_be_bytes());
            socket.get_mut().write_all(&header).await.unwrap();
            std::future::pending::<()>().await;
        });
        let options = SessionOptions {
            endpoint,
            username: "fixture-owner".into(),
            relay_target: None,
        };
        assert!(
            timeout(
                Duration::from_millis(500),
                login(options, Zeroizing::new("fixture-password".into()), None)
            )
            .await
            .unwrap()
            .is_err()
        );
        task.abort();
        let _ = task.await;
    }
}

#[cfg(test)]
mod storage_tests {
    #[derive(Default)]
    pub(super) struct Storage {
        pub(super) saved: std::sync::Mutex<Option<Vec<u8>>>,
        pub(super) fail: std::sync::atomic::AtomicBool,
    }
    impl crate::CredentialPersistence for Storage {
        fn begin_resume(&self) -> bool {
            *self.saved.lock().unwrap() = None;
            true
        }
        fn persist(&self, credential: Vec<u8>) -> bool {
            if self.fail.load(std::sync::atomic::Ordering::Acquire) {
                return false;
            }
            *self.saved.lock().unwrap() = Some(credential);
            true
        }
    }
}
