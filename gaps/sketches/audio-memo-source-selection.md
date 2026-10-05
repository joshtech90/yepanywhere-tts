# Audio memo source: microphone or “what you hear”

Requested follow-up, not part of the initial microphone-only audio memo flow.
Add an audio-source selector in the memo panel: **Microphone** (current source)
or **What you hear** (monitor / playback capture). Keep the existing memo
stop-and-send, restart, cancel and optional transcript behavior.

Browser and platform feasibility is unresolved. Distinguish audio from a
selected browser tab, a selected window and the entire system; none is a
portable promise to capture everything audible to the user.

Initial documentation check, 2026-10-01:

- [Chrome screen-sharing controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls)
  expose display-capture source choices and audio hints. These are not an
  ordinary microphone-device selector.
- [getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
  requires video capture in the request; audio is optional and depends on the
  chosen surface, browser and OS. Requesting audio does not guarantee an audio
  track. A successful future memo path must check the actual returned tracks
  and retain only audio in the attachment, while closing all capture tracks.
- Desktop Chrome on Windows, macOS and Linux, mobile Chrome/PWA, Android's
  embedded WebView and iOS/WKWebView each need device-backed verification.
  Mobile/native support and any native capture adapter remain unverified.

Before implementation, probe these environments and document which sources
really work. Show the actual source being recorded. If unavailable or denied,
explain the limitation; never silently record the microphone instead. Revisit
YA's playback-muting behavior for monitor capture so it does not silence the
source the user explicitly selected.

Requested 2026-10-01 during audio memo interaction design.
Contributing-model: 6-astra
