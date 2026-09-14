// Adapted from desktop-release-kit: contract/desktop-update-channels-v1.md.
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex, time::Duration};
use tauri::{ipc::Channel, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const ROOT: &str = "https://updates.yepanywhere.com/desktop";
const UPDATE_ENDPOINT: &str =
    "https://updates.yepanywhere.com/desktop/tauri/{{target}}/{{arch}}/{{current_version}}";
const SETTING: &str = "update-channel";

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Track {
    #[default]
    Stable,
    Latest,
}
impl Track {
    fn id(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Latest => "latest",
        }
    }
}

#[derive(Default)]
pub struct Updates {
    pub track: Track,
    generation: u64,
    candidate: Option<Update>,
    installing: bool,
}

impl Updates {
    pub fn new(track: Track) -> Self {
        Self {
            track,
            ..Self::default()
        }
    }
}

pub fn read_track(directory: &Path) -> Track {
    std::fs::read_to_string(directory.join(SETTING))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist_track(directory: &Path, track: Track) -> Result<(), String> {
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &track).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(directory.join(SETTING))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn get_update_channel(state: State<'_, Mutex<Updates>>) -> Result<Track, String> {
    Ok(state.lock().map_err(|e| e.to_string())?.track)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn set_update_channel(state: State<'_, Mutex<Updates>>, track: Track) -> Result<(), String> {
    let mut updates = state.lock().map_err(|e| e.to_string())?;
    if updates.installing {
        return Err("Wait for installation to finish before changing tracks".into());
    }
    let directory = crate::config::data_dir();
    persist_track(&directory, track)?;
    updates.track = track;
    updates.generation += 1;
    updates.candidate = None;
    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn clear_update(state: State<'_, Mutex<Updates>>) -> Result<(), String> {
    let mut updates = state.lock().map_err(|e| e.to_string())?;
    if updates.installing {
        return Err("Installation is in progress".into());
    }
    updates.generation += 1;
    updates.candidate = None;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    track: Track,
    version: Option<String>,
    notes: Option<String>,
    waiting_for_stable: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Discovery {
    schema_version: u8,
    channels: Vec<ChannelInfo>,
}
#[derive(Deserialize)]
struct ChannelInfo {
    id: String,
}
#[derive(Deserialize)]
struct VersionInfo {
    version: String,
}

async fn discover(root: &str, track: Track, current_version: &str) -> Result<(bool, bool), String> {
    // Discovery runs before the updater, which otherwise installs this provider.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("{root}/channels"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return if track == Track::Stable {
            Ok((false, false))
        } else {
            Err("This update server does not support Latest yet. Select Stable to keep using legacy updates.".into())
        };
    }
    let discovery: Discovery = response
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if discovery.schema_version != 1 || !discovery.channels.iter().any(|c| c.id == track.id()) {
        return Err(format!("The update server does not offer {}", track.id()));
    }
    let response = client
        .get(format!("{root}/version?channel={}", track.id()))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response
        .headers()
        .get("X-Update-Channel")
        .and_then(|v| v.to_str().ok())
        != Some(track.id())
    {
        return Err("The update server did not confirm the requested track".into());
    }
    let available: VersionInfo = response
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let current = semver::Version::parse(current_version).map_err(|e| e.to_string())?;
    let remote = semver::Version::parse(&available.version).map_err(|e| e.to_string())?;
    Ok((true, track == Track::Stable && current > remote))
}

#[tauri::command]
pub async fn check_update(
    app: tauri::AppHandle,
    state: State<'_, Mutex<Updates>>,
    reason: String,
) -> Result<CheckResult, String> {
    if !["startup", "periodic", "manual"].contains(&reason.as_str()) {
        return Err("Invalid check reason".into());
    }
    let (track, generation) = {
        let mut updates = state.lock().map_err(|e| e.to_string())?;
        if updates.installing {
            return Err("Installation is in progress".into());
        }
        updates.generation += 1;
        updates.candidate = None;
        (updates.track, updates.generation)
    };
    let (supported, waiting_for_stable) = discover(ROOT, track, env!("CARGO_PKG_VERSION")).await?;
    let endpoint = if supported {
        format!("{}?channel={}", UPDATE_ENDPOINT, track.id())
    } else {
        UPDATE_ENDPOINT.into()
    };
    let mut update = app
        .updater_builder()
        .endpoints(vec![endpoint
            .parse()
            .map_err(|e: url::ParseError| e.to_string())?])
        .map_err(|e| e.to_string())?
        .header("X-Check-Reason", reason)
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    // The plugin builder timeout covers discovery only, not the returned download.
    if let Some(candidate) = &mut update {
        candidate.timeout = Some(Duration::from_secs(120));
    }
    if supported
        && update.as_ref().is_some_and(|u| {
            u.raw_json
                .get("channel")
                .and_then(serde_json::Value::as_str)
                != Some(track.id())
        })
    {
        return Err("Update candidate did not confirm the requested track".into());
    }
    let mut updates = state.lock().map_err(|e| e.to_string())?;
    if updates.generation != generation || updates.track != track || updates.installing {
        return Err("Check superseded by a newer selection".into());
    }
    let result = CheckResult {
        track,
        version: update.as_ref().map(|u| u.version.clone()),
        notes: update.as_ref().and_then(|u| u.body.clone()),
        waiting_for_stable,
    };
    updates.candidate = update;
    Ok(result)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    installing: bool,
}

#[tauri::command]
pub async fn install_update(
    state: State<'_, Mutex<Updates>>,
    progress: Channel<Progress>,
) -> Result<(), String> {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    if !matches!(
        bundle_type(),
        Some(BundleType::App | BundleType::Nsis | BundleType::AppImage)
    ) {
        return Err("This package must be updated through its package manager".into());
    }
    let update = {
        let mut updates = state.lock().map_err(|e| e.to_string())?;
        if updates.installing {
            return Err("Installation is already in progress".into());
        }
        let update = updates
            .candidate
            .clone()
            .ok_or("Check for an update first")?;
        updates.installing = true;
        updates.generation += 1;
        update
    };
    let mut downloaded_bytes = 0;
    let result = update
        .download_and_install(
            |bytes, total_bytes| {
                downloaded_bytes += bytes as u64;
                let _ = progress.send(Progress {
                    downloaded_bytes,
                    total_bytes,
                    installing: false,
                });
            },
            || {
                let _ = progress.send(Progress {
                    downloaded_bytes: 0,
                    total_bytes: None,
                    installing: true,
                });
            },
        )
        .await;
    // Keep successful installation locked until relaunch. A failed install may
    // be retried or explicitly resolved by selecting a different channel.
    if result.is_err() {
        state.lock().map_err(|e| e.to_string())?.installing = false;
    }
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_default_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_track(dir.path()), Track::Stable);
        persist_track(dir.path(), Track::Latest).unwrap();
        assert_eq!(read_track(dir.path()), Track::Latest);
        std::fs::write(dir.path().join(SETTING), "unknown").unwrap();
        assert_eq!(read_track(dir.path()), Track::Stable);
    }
    #[test]
    fn native_comparator_orders_preview_train_and_stable_catchup() {
        let versions = ["0.2.0", "0.3.101", "0.3.102", "0.3.201", "0.4.0"];
        for pair in versions.windows(2) {
            assert!(
                semver::Version::parse(pair[0]).unwrap() < semver::Version::parse(pair[1]).unwrap()
            );
        }
    }
}

#[cfg(test)]
mod discovery_tests {
    use super::*;
    use std::io::{Read, Write};

    fn fixture(responses: Vec<(&str, &str, &str)>) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let responses: Vec<_> = responses.into_iter().map(|(status, header, body)| format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nConnection: close\r\n{header}Content-Length: {}\r\n\r\n{body}", body.len())).collect();
        let thread = std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = [0; 4096];
                assert!(stream.read(&mut request).unwrap() > 0);
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (root, thread)
    }

    #[test]
    fn legacy_discovery_preserves_stable_and_refuses_latest() {
        for track in [Track::Stable, Track::Latest] {
            let (root, thread) = fixture(vec![("404 Not Found", "", "not found")]);
            let result = tauri::async_runtime::block_on(discover(&root, track, "0.2.0"));
            if track == Track::Stable {
                assert_eq!(result.unwrap(), (false, false));
            } else {
                assert!(result.unwrap_err().contains("does not support Latest"));
            }
            thread.join().unwrap();
        }
    }

    #[test]
    fn stable_ahead_waits_and_latest_requires_channel_confirmation() {
        let body = r#"{"schemaVersion":1,"channels":[{"id":"stable"},{"id":"latest"}]}"#;
        let (root, thread) = fixture(vec![
            ("200 OK", "", body),
            (
                "200 OK",
                "X-Update-Channel: stable\r\n",
                r#"{"version":"0.2.0"}"#,
            ),
        ]);
        assert_eq!(
            tauri::async_runtime::block_on(discover(&root, Track::Stable, "0.3.101")).unwrap(),
            (true, true)
        );
        thread.join().unwrap();
        let (root, thread) = fixture(vec![
            ("200 OK", "", body),
            ("200 OK", "", r#"{"version":"0.4.0"}"#),
        ]);
        assert!(
            tauri::async_runtime::block_on(discover(&root, Track::Latest, "0.2.0"))
                .unwrap_err()
                .contains("did not confirm")
        );
        thread.join().unwrap();
    }

    #[test]
    fn unsupported_channels_and_network_errors_fail_closed() {
        for (status, body) in [
            (
                "200 OK",
                r#"{"schemaVersion":1,"channels":[{"id":"stable"}]}"#,
            ),
            ("503 Unavailable", "down"),
        ] {
            let (root, thread) = fixture(vec![(status, "", body)]);
            assert!(
                tauri::async_runtime::block_on(discover(&root, Track::Latest, "0.2.0")).is_err()
            );
            thread.join().unwrap();
        }
    }
}
