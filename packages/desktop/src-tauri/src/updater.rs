//! The process owns updates. No webview event loop is required to check,
//! acknowledge manual input, show progress, dismiss, or install a candidate.
use crate::channels::{self, Track, Updates};
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, PartialEq)]
pub enum Phase {
    Idle,
    Checking,
    Current,
    Waiting,
    Available(String),
    Failed(String),
    Downloading { bytes: u64, total: Option<u64> },
    Installing,
}
#[derive(Clone, Debug, PartialEq)]
pub struct View {
    pub visible: bool,
    pub track: Track,
    pub phase: Phase,
}
impl View {
    pub fn text(&self) -> String {
        match &self.phase {
            Phase::Idle | Phase::Checking => "Checking for updates…".into(),
            Phase::Current => format!("Yep Anywhere {} is up to date.", env!("CARGO_PKG_VERSION")),
            Phase::Waiting => {
                "Your installed version is newer than Stable. Waiting for Stable to catch up."
                    .into()
            }
            Phase::Available(v) => format!(
                "Yep Anywhere {v} is available.\nInstalled version: {}",
                env!("CARGO_PKG_VERSION")
            ),
            Phase::Failed(e) => format!("Could not update Yep Anywhere.\n{e}"),
            Phase::Downloading { .. } => "Downloading update…".into(),
            Phase::Installing => "Installing update and restarting…".into(),
        }
    }
    pub fn installing(&self) -> bool {
        matches!(self.phase, Phase::Downloading { .. } | Phase::Installing)
    }
    pub fn change_enabled(&self) -> bool {
        !self.installing() && self.phase != Phase::Checking
    }
    pub fn primary(&self) -> &'static str {
        if matches!(self.phase, Phase::Available(_)) {
            "Update and restart"
        } else {
            "Check again"
        }
    }
    pub fn fraction(&self) -> Option<f64> {
        match self.phase {
            Phase::Downloading {
                bytes,
                total: Some(total),
            } if total > 0 => Some((bytes as f64 / total as f64).min(1.0)),
            _ => None,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum Busy {
    None,
    Checking(u64),
    Installing,
}
/// Dismissal invalidates a check but doesn't release its single-flight owner.
/// A manual request after dismissal queues exactly one fresh check.
pub struct Flow {
    pub view: View,
    revision: u64,
    busy: Busy,
    pending_manual: bool,
}
impl Flow {
    pub fn new(track: Track) -> Self {
        Self {
            view: View {
                visible: false,
                track,
                phase: Phase::Idle,
            },
            revision: 0,
            busy: Busy::None,
            pending_manual: false,
        }
    }
    fn begin(&mut self, manual: bool) -> Option<u64> {
        if !manual && self.view.visible {
            return None;
        }
        if manual {
            self.view.visible = true;
        }
        match self.busy {
            Busy::Installing => return None,
            Busy::Checking(token) => {
                if manual && token != self.revision {
                    self.pending_manual = true;
                    self.view.phase = Phase::Checking;
                }
                return None;
            }
            Busy::None => {}
        }
        self.revision += 1;
        self.busy = Busy::Checking(self.revision);
        self.view.phase = Phase::Checking;
        Some(self.revision)
    }
    fn finish(&mut self, token: u64, result: Result<channels::CheckResult, String>) -> bool {
        if self.busy != Busy::Checking(token) {
            return false;
        }
        self.busy = Busy::None;
        if token == self.revision {
            self.view.phase = match result {
                Ok(result) => {
                    self.view.track = result.track;
                    if let Some(version) = result.version {
                        self.view.visible = true;
                        Phase::Available(version)
                    } else if result.waiting_for_stable {
                        Phase::Waiting
                    } else {
                        Phase::Current
                    }
                }
                Err(error) => Phase::Failed(error),
            };
        }
        std::mem::take(&mut self.pending_manual)
    }
    fn dismiss(&mut self) -> bool {
        if self.busy == Busy::Installing {
            return false;
        }
        self.revision += 1;
        self.pending_manual = false;
        self.view.visible = false;
        true
    }
}
pub type State = Mutex<Flow>;
#[derive(Clone, Copy)]
pub enum Action {
    Check,
    Close,
    Install,
    Select(Track),
}

pub fn snapshot(app: &AppHandle) -> View {
    app.state::<State>().lock().unwrap().view.clone()
}
fn render(app: &AppHandle, focus: bool) {
    crate::updater_ui::render(app, focus);
}

pub fn check(app: &AppHandle, reason: &'static str) {
    let token = app
        .state::<State>()
        .lock()
        .unwrap()
        .begin(reason == "manual");
    render(app, reason == "manual");
    if let Some(token) = token {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let result =
                channels::check_update(app.clone(), app.state::<Mutex<Updates>>(), reason.into())
                    .await;
            let pending = app.state::<State>().lock().unwrap().finish(token, result);
            render(&app, false);
            if pending {
                check(&app, "manual");
            }
        });
    }
}
pub fn act(app: &AppHandle, action: Action) {
    match action {
        Action::Check => check(app, "manual"),
        Action::Close => {
            if app.state::<State>().lock().unwrap().dismiss() {
                let _ = channels::clear_update(app.state::<Mutex<Updates>>());
                render(app, false);
            }
        }
        Action::Select(track) => {
            let owner = app.state::<State>();
            let mut state = owner.lock().unwrap();
            if state.busy != Busy::None {
                return;
            }
            match channels::set_update_channel(app.state::<Mutex<Updates>>(), track) {
                Ok(()) => {
                    state.view.track = track;
                    state.revision += 1;
                }
                Err(e) => {
                    state.view.phase = Phase::Failed(e);
                    drop(state);
                    render(app, false);
                    return;
                }
            }
            drop(state);
            check(app, "manual");
        }
        Action::Install => {
            let owner = app.state::<State>();
            let mut state = owner.lock().unwrap();
            if state.busy != Busy::None
                || !state.view.visible
                || !matches!(state.view.phase, Phase::Available(_))
            {
                return;
            }
            state.busy = Busy::Installing;
            state.view.phase = Phase::Downloading {
                bytes: 0,
                total: None,
            };
            drop(state);
            render(app, false);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let progress_app = app.clone();
                let result = channels::install_update(
                    app.clone(),
                    app.state::<Mutex<Updates>>(),
                    move |p| {
                        progress_app.state::<State>().lock().unwrap().view.phase = if p.installing {
                            Phase::Installing
                        } else {
                            Phase::Downloading {
                                bytes: p.downloaded_bytes,
                                total: p.total_bytes,
                            }
                        };
                        render(&progress_app, false);
                    },
                )
                .await;
                match result {
                    Ok(()) => app.restart(),
                    Err(error) => {
                        let owner = app.state::<State>();
                        let mut state = owner.lock().unwrap();
                        state.busy = Busy::None;
                        state.view.phase = Phase::Failed(error);
                        drop(state);
                        render(&app, false);
                    }
                }
            });
        }
    }
}
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        check(&app, "startup");
        loop {
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
            check(&app, "periodic");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn current() -> Result<channels::CheckResult, String> {
        Ok(channels::CheckResult {
            track: Track::Stable,
            version: None,
            waiting_for_stable: false,
        })
    }
    #[test]
    fn manual_joins_automatic_and_exposes_failure() {
        let mut f = Flow::new(Track::Stable);
        let token = f.begin(false).unwrap();
        assert!(!f.view.visible);
        assert_eq!(f.begin(true), None);
        assert!(f.view.visible);
        assert!(!f.finish(token, Err("Offline".into())));
        assert_eq!(f.view.phase, Phase::Failed("Offline".into()));
    }
    #[test]
    fn dismissal_suppresses_late_offer_and_reopen_queues_one_check() {
        let mut f = Flow::new(Track::Stable);
        let token = f.begin(true).unwrap();
        f.dismiss();
        assert_eq!(f.begin(true), None);
        assert_eq!(f.begin(true), None);
        assert!(f.finish(
            token,
            Ok(channels::CheckResult {
                track: Track::Stable,
                version: Some("99.0.0".into()),
                waiting_for_stable: false
            })
        ));
        assert_eq!(f.view.phase, Phase::Checking);
        let fresh = f.begin(true).unwrap();
        assert_ne!(fresh, token);
        assert!(!f.finish(fresh, current()));
        assert_eq!(f.view.phase, Phase::Current);
    }
    #[test]
    fn automatic_current_and_failure_stay_silent_but_manual_always_answers() {
        let mut f = Flow::new(Track::Stable);
        let token = f.begin(false).unwrap();
        f.finish(token, current());
        assert!(!f.view.visible);
        let token = f.begin(true).unwrap();
        f.finish(token, current());
        assert!(f.view.visible);
        assert_eq!(f.begin(false), None);
    }
    #[test]
    fn installation_cannot_be_dismissed_or_rechecked() {
        let mut f = Flow::new(Track::Stable);
        f.busy = Busy::Installing;
        f.view.phase = Phase::Installing;
        assert!(!f.dismiss());
        assert_eq!(f.begin(true), None);
        assert_eq!(f.view.phase, Phase::Installing);
    }
}
