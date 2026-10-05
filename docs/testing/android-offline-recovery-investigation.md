# Android offline recovery and swipe-up refresh

Investigated and repaired on 2026-10-04 with a physical Pixel 7a, Android
API 37, and a disposable standalone server on the public TLS relay. The initial
installed bundled Debug 0.1.2 (version code 1002) had an unidentified source
revision. Repair checks use a freshly built bundled Debug from this checkout.

## Device reproduction

Used Machine Control's Android doctor and exact-device adapter, the existing
`packages/mobile-core/scripts/fixture.mjs` standalone server fixture, and a
unique disposable registration on the public TLS relay. The server supplied
synthetic provider history. No production server was restarted. Inspected the
installed WebView through its debug CDP endpoint over USB.

1. Paired from the native login form, opened Projects, then its synthetic
   session. Confirmed the transcript and navigation were present.
2. Disabled both Wi-Fi and mobile data. A foreground loaded session retained
   its transcript at observations after 5, 15, and 35 seconds of deliberate
   waiting (device inspection adds overhead). No visible connection warning
   appeared. This does not establish that the underlying socket was healthy.
3. In a second outage, navigated from the session to cached Projects content;
   that navigation worked. Pressed Home and reopened the app through its
   launcher activity while still offline.
4. The app showed only `Error: Source transport secure is disconnected` on
   `/projects`, without a page header, sidebar opener, or retry action.
5. Restored both radios. The error persisted with `navigator.onLine === true`.
   A manual document reload restored Projects and navigation.
6. Repeated the Home/launcher sequence starting from the loaded session.
   After 20 seconds offline it again showed the Projects error; after restoring
   both radios and waiting another 12 seconds it remained stranded.

The second run reattached CDP after reopening because Android replaced the old
WebView target. The first multi-step runner lost its old CDP page at that point;
the error was then observed independently on the replacement target and in a
physical screenshot. These are launcher-reopening results, not proof of the
separate recent-apps resume path. Plain foreground network loss alone did not
reproduce the full-page error during the observation window.

The error screenshot was inspected and presented through `writeCapturePreview`
and `emitCapturePreview`. Ignored local evidence is under
`tasks/android-network-investigation/`: `outage.json`, `session-resume.json`,
`gesture.json`, `stranded-state.txt`, and `stranded-error.png`. These are local
artifacts, not checked-in test fixtures or portable links.

## Original owning mechanisms

- `ProjectsPage.tsx` returns its loading/error elements before `MainContent`
  and `PageHeader`. The error therefore also removes mobile navigation.
  `SessionPage.tsx` has a similar generic error early return.
- `WebClientActivity.onStop()` releases the document bridge, and `onStart()`
  reloads the document. Launcher entry can also open a fresh WebView at
  Projects. Reopening thus loses the previous in-memory page/query state
  before offline acquisition is attempted. Keeping a document alive while
  releasing transport demand requires deliberate bridge lifecycle work;
  merely removing the reload would leave its old document handle invalid.
- `NativeSourceTransport.ensureReady()` refuses requests in `disconnected`.
  `NativeConnectionProvider` retains a connection object but has no web-style
  focus/online recovery policy. Native reconnect has three bounded attempts;
  `YaServerConnectionManager` does not add another cycle after Rust exhaustion.
  The previous bridge reconnect only issued a version request; it could not
  replace a stale transport or restart an exhausted native cycle. No Android connectivity callback was
  found in the current native app source.
- The top `ConnectionBar` is gated by `showConnectionBars`, which defaults
  false. The session's disconnected rule depends on stream/transport state;
  reconnecting state is also hidden by default. Bars alone cannot repair
  acquisition, restore missing navigation, or wake an exhausted source.

The web recovery work in
[tactical 136](../tactical/136-recoverable-remote-connections.md) does not
automatically cover the native adapter. This differs from
[the background blank-page gap](../../gaps/background-relay-reconnect-blank-page.md):
here a concrete error element replaces the page and transport recovery is
missing, rather than a recovered transport driving an inexplicably blank shell.

## Swipe-up refresh

The existing `BottomOverscrollReload` is shared by local and remote web apps,
including bundled Android. It is disabled on session detail routes by both app
entries. Elsewhere it requires more than 48 CSS pixels of scroll overflow,
starting at the bottom, and an upward pull of at least 84 CSS pixels. It is
not Android's native pull-down refresh, and no setting currently enables it
inside a session.

A real Pixel upward swipe at the transcript bottom delivered `touchstart`,
multiple `touchmove` events and `touchend`, with no reload indicator or change
in `performance.timeOrigin`. This agrees with the explicit route gate.
Commit `3b06519b3` disabled session swipes because normal catch-up scrolling
caused accidental reloads. The session options menu currently offers
**Reload page** as an explicit alternative.

## Repair and verification

Projects and session failures now render inside the page, preserving navigation,
available content and the composer. The top connection bar no longer depends
on a developer setting. Native network loss updates it immediately; online,
visible demand and a slow visible backstop can request another native connection
cycle after exhaustion. Concurrent requests join one cycle. Lease ownership and
subscription intents survive replacement; background demand is still released.
Authentication rejection and revocation do not enter network recovery.

First activity-stream acquisition now revalidates reads that failed during cold
entry. A failed initial transcript reveal restarts its initial-load lifecycle on
recovery, rather than attempting incremental reconciliation against an
uninitialized transcript. A late upload chunk after interruption fails only the
upload, preserving the local document bridge.

Physical Pixel checks with Wi-Fi and mobile data disabled, Home, and launcher
reopening now show Projects with its navigation, inline failure/Retry and the
connection bar. Restoring both radios populates Projects automatically. The
browser fixture additionally verifies unchanged document identity through cold
Projects/session recovery and an offline-typed draft retained in its composer.
The real sequential typing check retains the 100 ms acknowledgement limit with
20 Hz / 1 MiB incoming frames (final browser maxima: 17.5 ms desktop and
12.7 ms phone). The rebuilt Pixel also passes the existing public-TLS-relay
native WebView/upload/typing instrumentation. A physical cold-session check
confirms the same document identity, retained offline draft, recovered transcript,
cleared inline error and healthy connection bar after restoring both radios.

Validation: root lint, formatting, typecheck, console scan and non-Android unit
suite; Android bundled unit tests and build; focused desktop/phone browser
recovery and sequential-typing cases, remote startup regression, physical native
relay instrumentation, real touch gestures and radio toggles. Follow-up focused
session tests cover the failed initial reveal and clearing recovered errors.
The full browser suite and iOS/device parity were not run for this Android repair.

An eligible Settings page was also tested on the Pixel: the existing upward
bottom-edge gesture **did reload without any gesture-code changes**. The
session-only restriction above therefore does not explain a native-wide missing
gesture. Browser pull-down at the top is separate and is not provided by Android
WebView. The bundled client now implements that top-edge gesture; an actual
Pixel downward swipe at the top of Settings reloads the same route. Gesture
regressions cover fitting pages, nested scroll ownership, inputs, cancellation,
multitouch and horizontal movement. The upward session restriction is unchanged.

The native lifecycle is unchanged: backgrounding releases the bridge and return
reloads the current route, while launcher entry may open Projects. These checks
do not claim retained in-memory DOM across Activity replacement or recent-apps
resume. The owning observable contract is
[mobile server pairing](../../topics/mobile-server-pairing.md#bundled-client-offline-entry-and-refresh).
