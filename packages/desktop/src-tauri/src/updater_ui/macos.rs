//! AppKit controls on Tauri's main thread. This window contains no webview.
use crate::{
    channels::Track,
    updater::{self, Action, Phase},
};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSBackingStoreType, NSButton, NSControl, NSFont, NSPopUpButton,
    NSProgressIndicator, NSProgressIndicatorStyle, NSTextField, NSWindow, NSWindowDelegate,
    NSWindowStyleMask,
};
use objc2_foundation::{
    MainThreadMarker, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
};
use std::cell::RefCell;
use tauri::AppHandle;

struct Ivars {
    app: AppHandle,
}
define_class!(
    // SAFETY: NSObject has no subclass invariants; all AppKit access is main-thread-only.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Ivars]
    struct Actions;
    unsafe impl NSObjectProtocol for Actions {}
    impl Actions {
        #[unsafe(method(primary:))]
        fn primary(&self, _sender: &NSControl) {
            let action = if matches!(updater::snapshot(&self.ivars().app).phase, Phase::Available(_)) { Action::Install } else { Action::Check };
            updater::act(&self.ivars().app, action);
        }
        #[unsafe(method(close:))]
        fn close(&self, _sender: &NSControl) { updater::act(&self.ivars().app, Action::Close); }
        #[unsafe(method(select:))]
        fn select(&self, sender: &NSPopUpButton) {
            updater::act(&self.ivars().app, Action::Select(if sender.indexOfSelectedItem() == 1 { Track::Latest } else { Track::Stable }));
        }
    }
    unsafe impl NSWindowDelegate for Actions {
        #[unsafe(method(windowShouldClose:))]
        fn should_close(&self, _window: &NSWindow) -> bool { updater::act(&self.ivars().app, Action::Close); false }
    }
);
impl Actions {
    fn new(app: AppHandle, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(Ivars { app });
        // SAFETY: NSObject init has this signature and returns the initialized object.
        unsafe { msg_send![super(this), init] }
    }
}
struct Panel {
    window: Retained<NSWindow>,
    status: Retained<NSTextField>,
    channel: Retained<NSPopUpButton>,
    progress: Retained<NSProgressIndicator>,
    primary: Retained<NSButton>,
    close: Retained<NSButton>,
    _actions: Retained<Actions>,
}
thread_local! { static PANEL: RefCell<Option<Panel>> = const { RefCell::new(None) }; }
fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
}
impl Panel {
    fn new(app: &AppHandle, mtm: MainThreadMarker) -> Self {
        let actions = Actions::new(app.clone(), mtm);
        // SAFETY: Allocated on the main thread; ARC owns the window and all subviews.
        unsafe {
            let window = NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                rect(0., 0., 460., 260.),
                NSWindowStyleMask::Titled
                    | NSWindowStyleMask::Closable
                    | NSWindowStyleMask::Miniaturizable,
                NSBackingStoreType::Buffered,
                false,
            );
            window.setReleasedWhenClosed(false);
            window.setTitle(&NSString::from_str("Yep Anywhere updates"));
            window.setDelegate(Some(ProtocolObject::from_ref(&*actions)));
            let content = window.contentView().expect("native updater content view");
            let status = NSTextField::wrappingLabelWithString(
                &NSString::from_str("Checking for updates…"),
                mtm,
            );
            status.setFrame(rect(24., 166., 412., 70.));
            status.setFont(Some(&NSFont::systemFontOfSize(14.)));
            content.addSubview(&status);
            let label = NSTextField::labelWithString(&NSString::from_str("Update channel"), mtm);
            label.setFrame(rect(24., 124., 108., 22.));
            content.addSubview(&label);
            let channel = NSPopUpButton::initWithFrame_pullsDown(
                NSPopUpButton::alloc(mtm),
                rect(144., 120., 292., 28.),
                false,
            );
            channel.addItemWithTitle(&NSString::from_str("Stable"));
            channel.addItemWithTitle(&NSString::from_str("Latest (nightly)"));
            channel.setTarget(Some(&actions));
            channel.setAction(Some(sel!(select:)));
            content.addSubview(&channel);
            let progress = NSProgressIndicator::initWithFrame(
                NSProgressIndicator::alloc(mtm),
                rect(24., 82., 412., 18.),
            );
            progress.setStyle(NSProgressIndicatorStyle::Bar);
            progress.setMinValue(0.);
            progress.setMaxValue(1.);
            content.addSubview(&progress);
            let primary = NSButton::buttonWithTitle_target_action(
                &NSString::from_str("Check again"),
                Some(&actions),
                Some(sel!(primary:)),
                mtm,
            );
            primary.setFrame(rect(270., 24., 166., 32.));
            content.addSubview(&primary);
            let close = NSButton::buttonWithTitle_target_action(
                &NSString::from_str("Close"),
                Some(&actions),
                Some(sel!(close:)),
                mtm,
            );
            close.setFrame(rect(172., 24., 90., 32.));
            content.addSubview(&close);
            window.center();
            Self {
                window,
                status,
                channel,
                progress,
                primary,
                close,
                _actions: actions,
            }
        }
    }
}
pub fn render(app: &AppHandle, focus: bool) {
    let view = updater::snapshot(app);
    let mtm = MainThreadMarker::new().expect("native updater must run on main thread");
    PANEL.with_borrow_mut(|slot| {
        if !view.visible {
            if let Some(panel) = slot {
                panel.window.orderOut(None);
            }
            return;
        }
        let panel = slot.get_or_insert_with(|| Panel::new(app, mtm));
        let was_visible = panel.window.isVisible();
        panel
            .status
            .setStringValue(&NSString::from_str(&view.text()));
        panel
            .channel
            .selectItemAtIndex(if view.track == Track::Latest { 1 } else { 0 });
        panel.channel.setEnabled(view.change_enabled());
        panel.primary.setTitle(&NSString::from_str(view.primary()));
        panel.primary.setEnabled(view.change_enabled());
        panel.close.setTitle(&NSString::from_str(
            if matches!(view.phase, Phase::Available(_)) {
                "Later"
            } else {
                "Close"
            },
        ));
        panel.close.setEnabled(!view.installing());
        let busy = view.phase == Phase::Checking || view.installing();
        panel.progress.setHidden(!busy);
        if let Some(fraction) = view.fraction() {
            unsafe {
                panel.progress.stopAnimation(None);
            }
            panel.progress.setIndeterminate(false);
            panel.progress.setDoubleValue(fraction);
        } else {
            panel.progress.setIndeterminate(true);
            if busy {
                unsafe {
                    panel.progress.startAnimation(None);
                }
            } else {
                unsafe {
                    panel.progress.stopAnimation(None);
                }
            }
        }
        if focus || !was_visible {
            panel.window.deminiaturize(None);
            panel.window.makeKeyAndOrderFront(None);
            #[allow(deprecated)]
            NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        }
    });
}
