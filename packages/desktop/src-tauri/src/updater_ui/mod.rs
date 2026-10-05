#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
static QUEUED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(target_os = "macos")]
static FOCUS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(windows)]
mod windows;

pub fn render(app: &tauri::AppHandle, focus: bool) {
    #[cfg(target_os = "macos")]
    {
        use std::sync::atomic::Ordering;
        if focus {
            FOCUS.store(true, Ordering::SeqCst);
        }
        if QUEUED.swap(true, Ordering::SeqCst) {
            return;
        }
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            QUEUED.store(false, Ordering::SeqCst);
            macos::render(&handle, FOCUS.swap(false, Ordering::SeqCst));
        }) {
            QUEUED.store(false, Ordering::SeqCst);
            eprintln!("Could not display native updater: {error}");
        }
    }
    #[cfg(windows)]
    windows::render(app, focus);
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = (app, focus); // No Linux desktop distribution is published.
}
