//! Local desktop delegation. Public labels and the proxy pathname are not
//! authority: registration arrives only through the sealed server's private
//! socket, and every use checks the registered kernel process incarnation.
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, io, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
    sync::{watch, Mutex, Semaphore},
};

const FRAME_LIMIT: u64 = 64 * 1024;
const REPLY_LIMIT: u64 = 4 * 1024 * 1024;
const MAX_LAUNCHES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ProcessIdentity {
    pid: i32,
    parent: i32,
    start: (u64, u64),
}
fn identity(pid: i32) -> Option<ProcessIdentity> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>();
    let result = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size as i32,
        )
    };
    if result != size as i32 {
        return None;
    }
    let info = unsafe { info.assume_init() };
    if info.pbi_uid != unsafe { libc::getuid() } || info.pbi_status == 5 {
        return None;
    }
    Some(ProcessIdentity {
        pid,
        parent: info.pbi_ppid as i32,
        start: (info.pbi_start_tvsec, info.pbi_start_tvusec),
    })
}
fn descendant(peer: ProcessIdentity, root: ProcessIdentity) -> bool {
    if identity(root.pid) != Some(root) {
        return false;
    }
    let mut current = peer;
    for _ in 0..64 {
        if current == root {
            return true;
        }
        if current.parent <= 1 || current.parent == current.pid {
            return false;
        }
        let Some(parent) = identity(current.parent) else {
            return false;
        };
        current = parent;
    }
    false
}
fn peer_identity(stream: &UnixStream) -> Option<ProcessIdentity> {
    use std::os::fd::AsRawFd;
    let mut pid: i32 = 0;
    let mut size = std::mem::size_of_val(&pid) as libc::socklen_t;
    if unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&mut pid as *mut i32).cast(),
            &mut size,
        )
    } != 0
        || size as usize != std::mem::size_of_val(&pid)
    {
        return None;
    }
    identity(pid)
}
#[derive(Clone)]
struct Launch {
    process: ProcessIdentity,
    generation: String,
}
#[derive(Default)]
struct Registry {
    launches: HashMap<String, Launch>,
    live: bool,
}
impl Registry {
    fn register(&mut self, id: &str, generation: &str, pid: i32, server: ProcessIdentity) -> bool {
        self.launches
            .retain(|_, launch| identity(launch.process.pid) == Some(launch.process));
        let Some(process) = identity(pid) else {
            return false;
        };
        if !self.live
            || self.launches.len() >= MAX_LAUNCHES
            || self.launches.contains_key(id)
            || self
                .launches
                .values()
                .any(|launch| launch.process == process)
            || process == server
            || !descendant(process, server)
        {
            return false;
        }
        self.launches.insert(
            id.into(),
            Launch {
                process,
                generation: generation.into(),
            },
        );
        true
    }
    fn owner(&self, peer: ProcessIdentity) -> Option<(String, Launch)> {
        if !self.live || identity(peer.pid) != Some(peer) {
            return None;
        }
        let mut eligible = self
            .launches
            .iter()
            .filter(|(_, launch)| descendant(peer, launch.process));
        let (id, launch) = eligible.next()?;
        if eligible.next().is_some() {
            return None;
        }
        Some((id.clone(), launch.clone()))
    }
    fn matches(&self, id: &str, launch: &Launch, peer: ProcessIdentity) -> bool {
        self.owner(peer).is_some_and(|(current, value)| {
            current == id
                && value.generation == launch.generation
                && value.process == launch.process
        })
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Registration {
    operation: String,
    request_id: String,
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    generation: String,
    pid: Option<i32>,
}
fn label(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && value.bytes().all(|byte| (33..=126).contains(&byte))
}
fn generation(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}
async fn line<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
    limit: u64,
) -> io::Result<Vec<u8>> {
    use tokio::io::AsyncReadExt;
    let mut bytes = Vec::new();
    reader.take(limit + 1).read_until(b'\n', &mut bytes).await?;
    if bytes.is_empty() {
        return Err(io::ErrorKind::UnexpectedEof.into());
    }
    if bytes.len() as u64 > limit || bytes.last() != Some(&b'\n') {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(bytes)
}
async fn send(stream: &mut UnixStream, value: Value) -> io::Result<()> {
    let mut bytes = serde_json::to_vec(&value)?;
    bytes.push(b'\n');
    tokio::time::timeout(Duration::from_secs(5), stream.write_all(&bytes)).await??;
    Ok(())
}
async fn proxy(
    stream: UnixStream,
    registry: Arc<Mutex<Registry>>,
    mut changed: watch::Receiver<u64>,
    mc_socket: PathBuf,
) -> io::Result<()> {
    let peer = peer_identity(&stream).ok_or(io::ErrorKind::PermissionDenied)?;
    let (id, launch) = registry
        .lock()
        .await
        .owner(peer)
        .ok_or(io::ErrorKind::PermissionDenied)?;
    let mut client = BufReader::new(stream);
    // No MC connection is made before authenticating the registered launch.
    let mut resident = BufReader::new(UnixStream::connect(mc_socket).await?);
    let mut opened = false;
    let state = registry.clone();
    let owner_id = id.clone();
    let owner_launch = launch.clone();
    let safety = async move {
        let mut timer = tokio::time::interval(Duration::from_secs(1));
        loop {
            tokio::select! { result = changed.changed() => { if result.is_err() { return Err(io::ErrorKind::PermissionDenied.into()); } }, _ = timer.tick() => {} }
            if !state.lock().await.matches(&owner_id, &owner_launch, peer) {
                return Err::<(), io::Error>(io::ErrorKind::PermissionDenied.into());
            }
        }
    };
    let relay = async {
        loop {
            let bytes = line(&mut client, FRAME_LIMIT).await?;
            if !registry.lock().await.matches(&id, &launch, peer) {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            let mut request: Value = serde_json::from_slice(&bytes)?;
            let object = request.as_object_mut().ok_or(io::ErrorKind::InvalidData)?;
            if object.contains_key("desktopDelegation") || object.contains_key("outerRecovery") {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            if !opened {
                if object.get("operation").and_then(Value::as_str) != Some("control.open") {
                    return Err(io::ErrorKind::PermissionDenied.into());
                }
                object.insert("desktopDelegation".into(), json!({"schema":"machine-control-desktop-delegation/v1", "sessionId":id, "sessionGeneration":launch.generation}));
                opened = true;
            } else if object.get("operation").and_then(Value::as_str) == Some("control.open") {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            send(resident.get_mut(), request).await?;
            // On uncertainty close; never replay a possibly delivered request.
            let reply =
                tokio::time::timeout(Duration::from_secs(30), line(&mut resident, REPLY_LIMIT))
                    .await??;
            if !registry.lock().await.matches(&id, &launch, peer) {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            tokio::time::timeout(Duration::from_secs(5), client.get_mut().write_all(&reply))
                .await??;
        }
    };
    tokio::select! { result = relay => result, result = safety => result }
}

pub struct Handoff {
    temporary: tempfile::TempDir,
    listener: UnixListener,
    pub pathname: String,
}
impl Handoff {
    /// A locator is not bearer authority. Only the exact sealed server process
    /// launched by native YA can establish the private registration channel.
    pub fn prepare() -> io::Result<Self> {
        use std::os::unix::fs::PermissionsExt;
        let temporary = tempfile::Builder::new()
            .prefix("ya-mc-")
            .tempdir_in("/tmp")?;
        std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o700))?;
        let path = temporary.path().join("server.sock");
        let listener = UnixListener::bind(&path)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            pathname: path.to_string_lossy().into_owned(),
            temporary,
            listener,
        })
    }
    pub fn start(self, server_pid: u32) -> io::Result<()> {
        let server = identity(server_pid as i32).ok_or(io::ErrorKind::NotFound)?;
        tauri::async_runtime::spawn(async move {
            let result = tokio::time::timeout(Duration::from_secs(15), async {
                loop {
                    let (stream, _) = self.listener.accept().await?;
                    if peer_identity(&stream) == Some(server) {
                        return Ok::<_, io::Error>(stream);
                    }
                    if identity(server.pid) != Some(server) {
                        return Err(io::ErrorKind::NotFound.into());
                    }
                }
            })
            .await;
            if let Ok(Ok(parent)) = result {
                let _ = serve(parent, server, self.temporary).await;
            }
        });
        Ok(())
    }
}
/// Fixed local, read-only profile discovery. Unsupported or unavailable
/// residents preserve legacy advertisement; no grant or intent is requested.
async fn profile(mc_socket: &std::path::Path) -> bool {
    let query = async {
        let mut stream = BufReader::new(UnixStream::connect(mc_socket).await?);
        send(
            stream.get_mut(),
            json!({"operation":"desktop.delegation.status", "requestId":"native-profile"}),
        )
        .await?;
        let bytes = line(&mut stream, 8192).await?;
        let value: Value = serde_json::from_slice(&bytes)?;
        Ok::<_, io::Error>(
            value.get("accepted").and_then(Value::as_bool) == Some(true)
                && value.pointer("/data/enabled").and_then(Value::as_bool) == Some(true)
                && value.pointer("/data/profile").and_then(Value::as_str)
                    == Some("ordinary_local_desktop"),
        )
    };
    tokio::time::timeout(Duration::from_secs(2), query)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(false)
}

async fn serve(
    parent: UnixStream,
    server: ProcessIdentity,
    temporary: tempfile::TempDir,
) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let path = temporary.path().join("control.sock");
    let listener = UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    let registry = Arc::new(Mutex::new(Registry {
        live: true,
        ..Registry::default()
    }));
    let (changed, receiver) = watch::channel(0u64);
    let slots = Arc::new(Semaphore::new(4));
    let mc_socket = dirs::home_dir()
        .ok_or(io::ErrorKind::NotFound)?
        .join("Library/Application Support/MachineControl/control.sock");
    let profile_socket = mc_socket.clone();
    let state = registry.clone();
    let accept = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let Ok(permit) = slots.clone().try_acquire_owned() else {
                continue;
            };
            let state = state.clone();
            let receiver = receiver.clone();
            let path = mc_socket.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let _ = proxy(stream, state, receiver, path).await;
            });
        }
    });
    let mut reader = BufReader::new(parent);
    let result = async {
        send(reader.get_mut(), json!({"protocol":1,"proxy":path})).await?;
        loop {
            let bytes = line(&mut reader, 4096).await?;
            if identity(server.pid) != Some(server) {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            let value: Registration = serde_json::from_slice(&bytes)?;
            if value.operation == "profile" {
                if !label(&value.request_id)
                    || !value.session_id.is_empty()
                    || !value.generation.is_empty()
                    || value.pid.is_some()
                {
                    return Err(io::ErrorKind::InvalidData.into());
                }
                let enabled = profile(&profile_socket).await;
                send(
                    reader.get_mut(),
                    json!({"request_id":value.request_id,"accepted":true,"enabled":enabled}),
                )
                .await?;
                continue;
            }
            if !label(&value.request_id)
                || !label(&value.session_id)
                || !generation(&value.generation)
            {
                return Err(io::ErrorKind::InvalidData.into());
            }
            let mut state = registry.lock().await;
            let accepted = match value.operation.as_str() {
                "register" => value.pid.is_some_and(|pid| {
                    state.register(&value.session_id, &value.generation, pid, server)
                }),
                "remove" => {
                    if state
                        .launches
                        .get(&value.session_id)
                        .is_some_and(|launch| launch.generation == value.generation)
                    {
                        state.launches.remove(&value.session_id);
                        true
                    } else {
                        !state.launches.contains_key(&value.session_id)
                    }
                }
                _ => false,
            };
            drop(state);
            changed.send_modify(|value| *value = value.wrapping_add(1));
            send(
                reader.get_mut(),
                json!({"request_id":value.request_id,"accepted":accepted}),
            )
            .await?;
        }
    }
    .await;
    registry.lock().await.live = false;
    changed.send_modify(|value| *value = value.wrapping_add(1));
    accept.abort();
    drop(temporary);
    result
}

/// Only the canonical sealed native executable and its bundled resources may
/// create the private handoff. Interpreter injection/source configurations
/// retain ordinary advertisement but cannot gain automatic delegation.
pub fn eligible() -> bool {
    if std::env::var("AUTH_DISABLED").ok().as_deref() == Some("true")
        || std::env::vars_os().any(|(name, _)| {
            name.to_string_lossy().starts_with("DYLD_")
                || name.to_string_lossy().starts_with("BUN_")
        })
        || crate::config::dev_dir().is_some()
        || cfg!(debug_assertions)
        || [
            "NODE_OPTIONS",
            "NODE_PATH",
            "BUN_OPTIONS",
            "BUN_INSPECT",
            "DYLD_INSERT_LIBRARIES",
            "DYLD_LIBRARY_PATH",
            "YEP_PROVIDER_HOST",
        ]
        .iter()
        .any(|name| std::env::var_os(name).is_some())
    {
        return false;
    }
    let Ok(executable) = std::env::current_exe().and_then(std::fs::canonicalize) else {
        return false;
    };
    let Some(app) = executable
        .parent()
        .and_then(std::path::Path::parent)
        .and_then(std::path::Path::parent)
    else {
        return false;
    };
    if executable.file_name().and_then(|value| value.to_str()) != Some("yep-anywhere-desktop")
        || app.extension().and_then(|value| value.to_str()) != Some("app")
    {
        return false;
    }
    std::process::Command::new("/usr/bin/codesign")
        .args([
            "--verify",
            "--deep",
            "--strict",
            "-R",
            "=anchor apple generic and identifier \"com.yepanywhere.desktop\"",
        ])
        .arg(app)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn profile_queries_current_choice_and_refuses_unsupported_or_malformed_replies() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("resident.sock");
        assert!(!profile(&path).await);
        let listener = UnixListener::bind(&path).unwrap();
        let server = tokio::spawn(async move {
            for response in [
                json!({"accepted":true,"data":{"enabled":true,"profile":"ordinary_local_desktop"}}),
                json!({"accepted":true,"data":{"enabled":false,"profile":"ordinary_local_desktop"}}),
                json!({"accepted":false,"errorCode":"unsupported_operation"}),
                json!({"accepted":true,"data":{"enabled":"true","profile":"ordinary_local_desktop"}}),
            ] {
                let (stream, _) = listener.accept().await.unwrap();
                let mut stream = BufReader::new(stream);
                let request: Value =
                    serde_json::from_slice(&line(&mut stream, 8192).await.unwrap()).unwrap();
                assert_eq!(request["operation"], "desktop.delegation.status");
                send(stream.get_mut(), response).await.unwrap();
            }
        });
        assert!(profile(&path).await);
        for _ in 0..3 {
            assert!(!profile(&path).await);
        }
        server.await.unwrap();
    }

    #[tokio::test]
    async fn registered_kernel_launch_forwards_once_and_lost_registration_closes_pending_io() {
        use std::process::Stdio;
        use tokio::process::Command;
        let temporary = tempfile::Builder::new()
            .prefix("ya-mc-kernel-")
            .tempdir_in("/tmp")
            .unwrap();
        let client_path = temporary.path().join("client.sock");
        let resident_path = temporary.path().join("resident.sock");
        let client_listener = UnixListener::bind(&client_path).unwrap();
        let resident_listener = UnixListener::bind(&resident_path).unwrap();
        let state = Arc::new(Mutex::new(Registry {
            live: true,
            ..Registry::default()
        }));
        let (changed, receiver) = watch::channel(0u64);
        let program = r#"import sys,socket,json
sys.stdin.readline()
s=socket.socket(socket.AF_UNIX);s.connect(sys.argv[1])
s.sendall(b'{"operation":"control.open","requestId":"fixture"}\n')
print('ended' if s.recv(4096)==b'' else 'reply',flush=True)
"#;
        let mut child = Command::new("/usr/bin/python3")
            .args(["-c", program, client_path.to_str().unwrap()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let id = "private-launch";
        let generation = "00000000-0000-0000-0000-000000000001";
        assert!(state.lock().await.register(
            id,
            generation,
            child.id().unwrap() as i32,
            identity(std::process::id() as i32).unwrap()
        ));
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(b"go\n")
            .await
            .unwrap();
        let (client, _) = client_listener.accept().await.unwrap();
        let owner = tokio::spawn(proxy(client, state.clone(), receiver, resident_path));
        let (resident, _) = resident_listener.accept().await.unwrap();
        let mut resident = BufReader::new(resident);
        let bytes = line(&mut resident, FRAME_LIMIT).await.unwrap();
        let request: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(request["desktopDelegation"]["sessionId"], id);
        assert_eq!(
            request["desktopDelegation"]["sessionGeneration"],
            generation
        );
        // Deliberately leave the upstream reply stalled. Registration loss must
        // close the MC connection promptly, not wait for its response timeout.
        state.lock().await.launches.clear();
        changed.send_modify(|value| *value += 1);
        assert!(tokio::time::timeout(Duration::from_secs(2), owner)
            .await
            .unwrap()
            .unwrap()
            .is_err());
        assert!(line(&mut resident, FRAME_LIMIT).await.is_err());
        let mut output = BufReader::new(child.stdout.take().unwrap());
        assert_eq!(line(&mut output, 128).await.unwrap(), b"ended\n");
        assert!(child.wait().await.unwrap().success());
    }
    #[tokio::test]
    async fn unrelated_kernel_peer_is_refused_before_upstream_connection() {
        let temporary = tempfile::tempdir_in("/tmp").unwrap();
        let path = temporary.path().join("client.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let client = UnixStream::connect(&path).await.unwrap();
        let (server, _) = listener.accept().await.unwrap();
        let state = Arc::new(Mutex::new(Registry {
            live: true,
            ..Registry::default()
        }));
        let (_changed, receiver) = watch::channel(0u64);
        let result = proxy(
            server,
            state,
            receiver,
            temporary.path().join("nonexistent.sock"),
        )
        .await;
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::PermissionDenied);
        drop(client);
    }
    #[test]
    fn public_labels_do_not_admit_unregistered_or_reused_processes() {
        let current = identity(std::process::id() as i32).unwrap();
        let mut registry = Registry {
            live: true,
            ..Registry::default()
        };
        assert!(registry.owner(current).is_none());
        let mut stale = current;
        stale.start.1 += 1;
        registry.launches.insert(
            "copied-label".into(),
            Launch {
                process: stale,
                generation: "generation".into(),
            },
        );
        assert!(registry.owner(current).is_none());
        registry.launches.insert(
            "copied-label".into(),
            Launch {
                process: current,
                generation: "generation".into(),
            },
        );
        assert!(registry.owner(current).is_some());
        registry.live = false;
        assert!(registry.owner(current).is_none());
    }
    #[test]
    fn bounded_registration_cannot_register_the_server_or_public_shell() {
        let current = identity(std::process::id() as i32).unwrap();
        let mut registry = Registry {
            live: true,
            ..Registry::default()
        };
        assert!(!registry.register("session", "generation", current.pid, current));
        assert!(!registry.register("session", "generation", current.parent, current));
        assert!(label("session"));
        assert!(!label("bad label"));
        assert!(!generation("copied-label"));
    }
}
