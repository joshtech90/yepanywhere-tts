# Android system theme validation

The host wizard's Auto appearance followed its fixed light Android theme.
The companion's web UI followed its fixed dark Android theme, even though its
native Compose host management already followed the system. Both shells now
provide a day/night-qualified `android:isLightTheme` value to WebView.
The companion qualifies the public attribute for API 29+, retaining its
existing pre-Android-10 theme. No JavaScript bridge or forced page darkening
is needed.

## Pixel 7a acceptance

Physical Android 17 / WebView 154 checks passed:

- Host Auto rendered dark, light and dark again through actual system theme
  changes while the app remained running. Its ordinary Activity recreation
  remounted the authenticated local page each time.
- In each system mode, explicit Light, Dark and Very Dark retained their
  requested colors. The twelve observations covered the actual media query,
  selected `data-theme` and computed body background.
- Full-device captures of the shared onboarding wizard showed Auto selected
  with the appropriate light/dark palette, readable controls and no horizontal
  overflow. This initial WebView-only check left native toolbar colors
  unchanged.
- Companion `webColorSchemeMatchesSystemAfterRecreation` and
  `darkNativeSystemBarsKeepLightIconsAfterRecreation` passed in both system
  modes. Each two-test instrumentation run took about 2.3 seconds. The new
  regression compares both media-query results with Android configuration,
  before and after Activity recreation.
- The original system mode and saved YA appearance preference were restored.

The host observation used the debug WebView's CDP endpoint with
`page.emulateMedia({ colorScheme: null })`. Playwright's default light media
emulation otherwise masks the native preference and gives a false failure.
Visual evidence used the actual phone display rather than a desktop browser,
which cannot exercise this Android theme boundary. Captures and device
selectors remain private under the host package's ignored `.local/` directory.

## Other checks

Both Android apps built and passed lint; companion JVM unit tests passed.
Host Debug/Release builds and the shared Alpine smoke passed, including
authenticated API access, frontend serving, SQLite and restart persistence.
Root lint, formatter verification, typechecking and the full workspace tests
passed. An initial full run hit the existing file-completion inventory test's
30-second timeout; its focused rerun passed, followed by a passing full run.

The native behavior was validated on Android only. Linux, macOS and Windows
native clients were not changed or qualified by these phone checks.

## Host native appearance follow-up

The host's native menu and web header still used a fixed light theme after the
WebView fix. The host now selects Android's light or dark Material theme through
day/night resources, with matching status/navigation-bar icon appearance.
Native controls follow the system independently of the web appearance choice.

The updated Debug APK was installed on the Pixel 7a. Physical display captures
of the menu, web header and tabs dialog confirmed readable text, buttons and
system-bar icons in both modes, without clipping. The Auto wizard continued to
match the system palette. The device checks used actual Android theme changes;
desktop browser captures cannot establish this native behavior.
The menu, header and tabs passed a dark/light/dark sequence while the app
remained running. Android's UI inspection process was killed during the first
sequence; the complete repeat passed. The original system mode was restored.

Host Debug/Release builds, Android lint, focused host profile tests, Alpine smoke
and root lint, format verification, typechecking and workspace tests passed.
No desktop-native behavior changed.
