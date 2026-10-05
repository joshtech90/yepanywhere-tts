//! Native-only owner sessions. The web bridge receives source operations only.
#[cfg(target_os = "android")]
mod android;
mod crypto;
mod events;
mod mux;
mod runtime;
mod session;
pub use runtime::{NativeRuntime, NativeSourceLease};
mod wire;
use serde_json::Value;
pub use session::{NativeRoute, NativeSecurityBinding, NativeSession, SessionOptions};
uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    #[error("Invalid or unauthenticated server message")]
    InvalidMessage,
    #[error("Connection unavailable")]
    Unavailable,
    #[error("Operation timed out")]
    Timeout,
    #[error("Session closed")]
    Closed,
    #[error("Native resource limit exceeded")]
    Overflow,
    #[error("Sign in again")]
    ReauthenticationRequired,
}
pub use CoreError as Error;
pub type Result<T> = std::result::Result<T, Error>;
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::InvalidMessage
    }
}
fn check(ok: bool) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(Error::InvalidMessage)
    }
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn native_login(
    options: SessionOptions,
    password: String,
) -> Result<std::sync::Arc<NativeSession>> {
    session::login(options, zeroize::Zeroizing::new(password), None).await
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn native_resume(
    options: SessionOptions,
    credential: Vec<u8>,
) -> Result<std::sync::Arc<NativeSession>> {
    let credential = zeroize::Zeroizing::new(credential);
    session::resume(options, &credential, None).await
}
fn parse(text: &str, limit: usize) -> Result<Value> {
    if text.len() > limit {
        return Err(Error::Overflow);
    }
    Ok(serde_json::from_str(text)?)
}

/// Native storage owns the durable downgrade pin. Before a resume can observe
/// a newer proof, invalidate its older stored credential; a storage failure or
/// cancelled future must not leave that older pin usable after process death.
#[uniffi::export(with_foreign)]
pub trait CredentialPersistence: Send + Sync {
    fn begin_resume(&self) -> bool;
    fn persist(&self, credential: Vec<u8>) -> bool;
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn native_login_stored(
    options: SessionOptions,
    password: String,
    storage: std::sync::Arc<dyn CredentialPersistence>,
) -> Result<std::sync::Arc<NativeSession>> {
    session::login(options, zeroize::Zeroizing::new(password), Some(storage)).await
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn native_resume_stored(
    options: SessionOptions,
    credential: Vec<u8>,
    storage: std::sync::Arc<dyn CredentialPersistence>,
) -> Result<std::sync::Arc<NativeSession>> {
    let credential = zeroize::Zeroizing::new(credential);
    session::resume(options, &credential, Some(storage)).await
}

/// Candidates are native saved configuration, never supplied by the web bridge.
#[uniffi::export(async_runtime = "tokio")]
pub async fn native_resume_routes_stored(
    routes: Vec<NativeRoute>,
    username: String,
    credential: Vec<u8>,
    storage: std::sync::Arc<dyn CredentialPersistence>,
) -> Result<std::sync::Arc<NativeSession>> {
    let credential = zeroize::Zeroizing::new(credential);
    session::resume_routes(routes, username, &credential, storage).await
}
