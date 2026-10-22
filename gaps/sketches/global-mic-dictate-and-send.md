# Global dictate-and-send through a Chrome extension

Status: user-requested sketch; implementation is not authorized by this record.

## Intended experience

YA stays visible on monitor 2, selected in its Chrome window, while a fullscreen
Steam/OpenGL game on monitor 1 keeps keyboard focus. The YA window need not be
the foremost Chrome window. An optional global **Ctrl+Space** binding starts
dictation; a second press stops capture, finishes transcription, and sends the
message to the same session. Neither press activates Chrome or returns focus
through an application switch.

The global command ships **unbound**, not enabled by default. With it disabled,
YA's existing in-page Ctrl+Space mic toggle remains unchanged. When enabled,
the extension owns that chord, including while Chrome is focused; one press
must never trigger both the extension and the page shortcut.

## Proposed mechanism

Use a Chrome Manifest V3 extension with a global command. Its worker selects
the last-focused YA composer among the selected tabs of eligible Chrome
windows, then dispatches a narrow command through a content-script bridge.
YA executes its existing speech and submission paths. The extension carries
commands and acknowledgements, not microphone audio or transcription work.
No new YA server endpoint, global keysniffer, or AHK focus switch is proposed.

Chrome supports global extension commands while another application has focus.
Omitting `suggested_key` leaves a command unbound. The user assigns Ctrl+Space
at `chrome://extensions/shortcuts`; suggested global defaults are restricted
to Ctrl+Shift+digits, but users may remap them. See the
[Chrome Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands#scope).

The existing [composer beacon](../../topics/composer-hotkey-beacon.md) supplies
recency and the selected-window workflow. Its AHK arm/acceptance handshake is
not a mic protocol: the extension needs an explicit command/result interface
that works without document or composer focus. Selection and microphone
ownership must remain separate from native focus.

## YA command contract to design

- First press pins browser tab, source, session and speech insertion target.
  Subsequent stop/send addresses that capture even if another composer becomes
  more recent. Navigation or owner loss must not redirect captured speech.
- Reuse the mic control's lifecycle and composer submission mechanism. Current
  entry points are `packages/client/src/components/VoiceInputButton.tsx`
  (`handleUserToggle`) and `packages/client/src/components/MessageInput.tsx`;
  the ordinary keyboard adapter is
  `packages/client/src/lib/voiceInputShortcut.ts`.
- Report actual starting, recording, finalizing, sending, accepted and error
  states, correlated with a request/capture identity. Command receipt alone
  does not establish microphone readiness or message acceptance.
- Second press requests stop, settles that capture's transcript, then submits
  once. Repeated keys and presses during finalization/submission cannot create
  duplicate sends. Decide explicitly how a second press during microphone
  startup records a pending stop-and-send request.
- Preserve normal speech insertion and draft handling. Recognition or send
  failure leaves recoverable text and a visible error; never submit incomplete
  transcription merely to complete the shortcut. Reconcile explicit second-
  press sending with existing spoken-send/automatic-send behavior so they
  cannot submit the same capture twice.
- Acknowledgements survive extension-worker suspension through explicit state
  queries/request identities. A restarted worker must not guess that recording
  stopped or choose a new destination for an existing capture.
- Limit the bridge to approved YA origins and explicit mic commands. Decide
  origin grants and enrollment for hosted YA and custom/local installations;
  do not expose a general JavaScript execution or remote keyboard interface.

The current speech contracts are in
[mic-button speech UI](../../topics/mic-button-speech-ui.md) and
[pluggable speech recognition](../../topics/pluggable-speech-recognition.md).
In particular, inspect existing stop/finalization and follow-up behavior before
wiring a new caller; a bare toggle followed immediately by send is insufficient.

## Verification before adoption

Verify on Windows 10 with microphone permission granted beforehand and the
chosen speech provider: unfocused start/stop, transcription settlement, existing
draft insertion, failed recognition/send recovery, repeated hotkeys, multiple
Chrome windows, navigation, worker suspension and destination pinning. Confirm
the chord is registered globally and that the normal page shortcut does not
double-handle it. Then test the actual fullscreen game: exclusive-input access
or a conflicting shortcut may prevent delivery. Background microphone capture
and game hotkey delivery are not established by the Commands API documentation.

An AHK focus-switch mic helper is a possible fallback, but does not meet this
sketch's uninterrupted-game-focus objective. Fullscreen overlays and inactive-
tab discovery are outside the initial scope.

Recorded 2026-10-20 after implementing the composer title beacon, at the user's
request. Contributing-model: 6-astra.
