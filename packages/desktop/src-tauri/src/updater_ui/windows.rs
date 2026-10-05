//! Common Controls v6 Task Dialog with native buttons, radios and progress.
//! One bounded UI thread exists only while the updater is visible.
use crate::{
    channels::Track,
    updater::{self, Action, Phase, View},
};
use std::cell::{Cell, RefCell};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use tauri::AppHandle;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, WPARAM},
    UI::{
        Controls::*,
        WindowsAndMessaging::{SendMessageW, SetForegroundWindow, IDCANCEL},
    },
};
static OPEN: AtomicBool = AtomicBool::new(false);
static WINDOW: AtomicIsize = AtomicIsize::new(0);
const PRIMARY: i32 = 100;
const CLOSE: i32 = 103;
const STABLE: i32 = 101;
const LATEST: i32 = 102;
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
struct Page {
    _title: Vec<u16>,
    _heading: Vec<u16>,
    _text: Vec<u16>,
    _primary: Vec<u16>,
    _close: Vec<u16>,
    _stable: Vec<u16>,
    _latest: Vec<u16>,
    _buttons: Vec<TASKDIALOG_BUTTON>,
    _radios: Vec<TASKDIALOG_BUTTON>,
    config: TASKDIALOGCONFIG,
}
impl Page {
    fn new(view: &View, data: isize) -> Self {
        let title = wide("Yep Anywhere updates");
        let heading = wide("Yep Anywhere updates");
        let text = wide(&view.text());
        let primary = wide(view.primary());
        let close = wide(if matches!(view.phase, Phase::Available(_)) {
            "Later"
        } else {
            "Close"
        });
        let stable = wide("Stable");
        let latest = wide("Latest (nightly)");
        let buttons = vec![
            TASKDIALOG_BUTTON {
                nButtonID: PRIMARY,
                pszButtonText: primary.as_ptr(),
            },
            TASKDIALOG_BUTTON {
                nButtonID: CLOSE,
                pszButtonText: close.as_ptr(),
            },
        ];
        let radios = vec![
            TASKDIALOG_BUTTON {
                nButtonID: STABLE,
                pszButtonText: stable.as_ptr(),
            },
            TASKDIALOG_BUTTON {
                nButtonID: LATEST,
                pszButtonText: latest.as_ptr(),
            },
        ];
        // Tauri's default executable manifest activates Common Controls v6.
        let config = TASKDIALOGCONFIG {
            cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
            dwFlags: TDF_ALLOW_DIALOG_CANCELLATION
                | TDF_CALLBACK_TIMER
                | TDF_SHOW_PROGRESS_BAR
                | TDF_SIZE_TO_CONTENT,

            pszWindowTitle: title.as_ptr(),
            pszMainInstruction: heading.as_ptr(),
            pszContent: text.as_ptr(),
            cButtons: buttons.len() as u32,
            pButtons: buttons.as_ptr(),
            nDefaultButton: CLOSE,
            cRadioButtons: radios.len() as u32,
            pRadioButtons: radios.as_ptr(),
            nDefaultRadioButton: if view.track == Track::Latest {
                LATEST
            } else {
                STABLE
            },
            pfCallback: Some(callback),
            lpCallbackData: data,
            cxWidth: 280,
            ..unsafe { std::mem::zeroed() }
        };
        Self {
            _title: title,
            _heading: heading,
            _text: text,
            _primary: primary,
            _close: close,
            _stable: stable,
            _latest: latest,
            _buttons: buttons,
            _radios: radios,
            config,
        }
    }
}
struct Dialog {
    app: AppHandle,
    page: RefCell<Option<Page>>,
    view: RefCell<View>,
    closing: Cell<bool>,
}
unsafe fn send(hwnd: HWND, message: i32, w: usize, l: isize) {
    unsafe {
        SendMessageW(hwnd, message as u32, w, l);
    }
}
fn controls(hwnd: HWND, view: &View) {
    // SAFETY: Called only with the live Task Dialog handle from its callback.
    unsafe {
        send(
            hwnd,
            TDM_ENABLE_BUTTON,
            PRIMARY as usize,
            view.change_enabled() as isize,
        );
        send(
            hwnd,
            TDM_ENABLE_BUTTON,
            CLOSE as usize,
            (!view.installing()) as isize,
        );
        send(
            hwnd,
            TDM_ENABLE_RADIO_BUTTON,
            STABLE as usize,
            view.change_enabled() as isize,
        );
        send(
            hwnd,
            TDM_ENABLE_RADIO_BUTTON,
            LATEST as usize,
            view.change_enabled() as isize,
        );
        if let Some(f) = view.fraction() {
            send(hwnd, TDM_SET_PROGRESS_BAR_MARQUEE, 0, 0);
            send(hwnd, TDM_SET_MARQUEE_PROGRESS_BAR, 0, 0);
            send(hwnd, TDM_SET_PROGRESS_BAR_POS, (f * 100.) as usize, 0);
        } else {
            let busy = view.phase == Phase::Checking || view.installing();
            send(hwnd, TDM_SET_MARQUEE_PROGRESS_BAR, busy as usize, 0);
            send(hwnd, TDM_SET_PROGRESS_BAR_MARQUEE, busy as usize, 30);
            if !busy {
                send(hwnd, TDM_SET_PROGRESS_BAR_POS, 0, 0);
            }
        }
    }
}
unsafe extern "system" fn callback(
    hwnd: HWND,
    notification: u32,
    w: WPARAM,
    _l: LPARAM,
    data: isize,
) -> i32 {
    // SAFETY: TaskDialogIndirect retains this boxed context until it returns.
    // Nested TDM_NAVIGATE_PAGE callbacks only read app state, never mutate page.
    let dialog = unsafe { &*(data as *const Dialog) };
    match notification as i32 {
        TDN_CREATED => {
            WINDOW.store(hwnd as isize, Ordering::SeqCst);
            controls(hwnd, &updater::snapshot(&dialog.app));
            unsafe {
                SetForegroundWindow(hwnd);
            }
        }
        TDN_NAVIGATED => controls(hwnd, &updater::snapshot(&dialog.app)),
        TDN_BUTTON_CLICKED => {
            // A timer-driven close must not dismiss a new manual request that
            // arrived after its hidden-state snapshot. The outer loop restores it.
            if dialog.closing.get() {
                return 0;
            }
            if w as i32 == PRIMARY {
                updater::act(
                    &dialog.app,
                    if matches!(updater::snapshot(&dialog.app).phase, Phase::Available(_)) {
                        Action::Install
                    } else {
                        Action::Check
                    },
                );
                return 1; // S_FALSE keeps the same native window open.
            }
            if updater::snapshot(&dialog.app).installing() {
                return 1;
            }
            updater::act(&dialog.app, Action::Close);
        }
        TDN_RADIO_BUTTON_CLICKED => {
            let track = if w as i32 == LATEST {
                Track::Latest
            } else {
                Track::Stable
            };
            if track != updater::snapshot(&dialog.app).track {
                updater::act(&dialog.app, Action::Select(track));
            }
        }
        TDN_TIMER => {
            let view = updater::snapshot(&dialog.app);
            if !view.visible {
                dialog.closing.set(true);
                unsafe {
                    send(hwnd, TDM_CLICK_BUTTON, IDCANCEL as usize, 0);
                }
                return 0;
            }
            if view != *dialog.view.borrow() {
                // Byte progress does not rebuild controls. New states/version/channel do.
                let only_progress = matches!(
                    (&view.phase, &dialog.view.borrow().phase),
                    (Phase::Downloading { .. }, Phase::Downloading { .. })
                ) && view.track == dialog.view.borrow().track;
                *dialog.view.borrow_mut() = view.clone();
                if !only_progress {
                    let page = Page::new(&view, data);
                    // Keep both pages alive through navigation and its nested callbacks.
                    let previous = dialog.page.replace(Some(page));
                    let config =
                        &dialog.page.borrow().as_ref().unwrap().config as *const TASKDIALOGCONFIG;
                    unsafe {
                        send(hwnd, TDM_NAVIGATE_PAGE, 0, config as isize);
                    }
                    drop(previous);
                }
                controls(hwnd, &view);
            }
        }
        TDN_DESTROYED => {
            WINDOW.store(0, Ordering::SeqCst);
        }
        _ => {}
    }
    0
}
pub fn render(app: &AppHandle, focus: bool) {
    let view = updater::snapshot(app);
    if !view.visible {
        return;
    }
    if OPEN.swap(true, Ordering::SeqCst) {
        let hwnd = WINDOW.load(Ordering::SeqCst);
        if focus && hwnd != 0 {
            unsafe {
                SetForegroundWindow(hwnd as HWND);
            }
        }
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let dialog = Box::new(Dialog {
            app,
            page: RefCell::new(None),
            view: RefCell::new(view),
            closing: Cell::new(false),
        });
        let data = (&*dialog as *const Dialog) as isize;
        let initial = Page::new(&dialog.view.borrow(), data);
        let config = &initial.config as *const TASKDIALOGCONFIG;
        let mut button = 0;
        // SAFETY: All config strings/buttons and the context outlive this native modal loop.
        let result = unsafe {
            TaskDialogIndirect(
                config,
                &mut button,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        WINDOW.store(0, Ordering::SeqCst);
        OPEN.store(false, Ordering::SeqCst);
        if result < 0 {
            eprintln!("Could not display native updater: HRESULT {result:#x}");
            updater::act(&dialog.app, Action::Close);
        }
        // A manual request can arrive while the old dialog is finishing closing.
        if updater::snapshot(&dialog.app).visible {
            render(&dialog.app, true);
        }
    });
}
