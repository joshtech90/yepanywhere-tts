# Yep Anywhere Desktop

Desktop v0 is a stable shell around the bundled Yep Anywhere server. The
installer includes the Tauri app, a private Bun runtime, and the matching
server/client build. First launch does not run a package manager or provider
login wizard.

Claude or Codex is expected to be managed outside Yep Anywhere. If neither
provider application is detected, the dashboard still opens and links to the
official [Claude download](https://claude.com/download) and
[Codex setup](https://openai.com/codex/get-started/) pages. Authentication is
checked only when the normal provider/session UI needs it.

## Windows installation

The signed `YepAnywhere_<version>_x64-setup.exe` NSIS artifact is the only
installer. Interactive installation is the default. Quiet installation uses:

```powershell
.\YepAnywhere_<version>_x64-setup.exe /S
```

Windows releases publish only this non-elevated NSIS installer. Automatic
updates use the same signed NSIS artifact and do not request administrator
access.

The NSIS uninstaller accepts `/S`. Ordinary update, reinstall, and uninstall
preserve the desktop data directory at `%USERPROFILE%\.yep-anywhere-desktop`.
Remove that directory only when an explicit full data reset is intended.

The tray menu provides Dashboard, Server Output, Desktop Diagnostics, update
checks, autostart, startup view, restart, quit, and three explicit dashboard
close behaviors:

- **Unload Dashboard After 5 Minutes** (default) hides immediately, then
  destroys the WebView if it stays hidden while leaving the tray app, server,
  and provider sessions running. Reopening restores the last dashboard route.
- **Keep Dashboard Loaded** hides the window but keeps its WebView alive for
  the fastest possible reopen.
- **Quit Yep Anywhere** stops the bundled server and exits when the dashboard
  is closed.

A manual reinstall of a signed release is the v0 recovery path; automatic
downgrade is not supported.

## Local Windows build and smoke

From a prepared checkout:

```powershell
pnpm --dir packages/desktop prepare-runtime
pnpm --dir packages/desktop smoke-runtime
scripts\install-local-tauri-windows.bat
```

The local helper builds an unsigned NSIS package, installs it with `/S`, and
launches the installed app. Use `--no-launch` when only install behavior is
being tested.

To smoke the delayed-unload lifecycle without waiting five minutes, launch the
app from a test shell with both explicit overrides:

```powershell
$env:YEP_DESKTOP_TEST_MODE = "1"
$env:YEP_DESKTOP_TEST_UNLOAD_DELAY_MS = "1500"
$env:YEP_DESKTOP_TEST_DATA_DIR = "$env:TEMP\yep-desktop-smoke"
.\YepAnywhere.exe
```

The delay override is ignored unless test mode is also exactly `1`, and it
does not change the saved desktop preference. The optional data-directory
override is guarded by the same test-mode switch so an isolated smoke does not
touch the normal desktop profile.

## Local macOS build and smoke

From a prepared checkout:

```bash
pnpm --dir packages/desktop prepare-runtime
pnpm --dir packages/desktop smoke-runtime
scripts/install-local-tauri-macos.sh
```

Tagged macOS releases sign the Tauri shell and private Bun sidecar with the
hardened runtime. Bun uses JavaScriptCore, so the final Bun signature must
retain `com.apple.security.cs.allow-jit=true`. Release CI smokes the Bun and
server resources from the final signed `.app` before the release action uploads
artifacts.

## Release QA history

End-to-end checks against published installers and updater feeds are recorded
in the [desktop release QA log](../../docs/testing/desktop-release-qa-log.md).

## Rust checks (`cargo check` / `cargo build`)

`src-tauri/tauri.conf.json` declares a Bun sidecar via
`bundle.externalBin: ["binaries/bun"]`. Tauri resolves this to a
platform-specific binary (`src-tauri/binaries/bun-<target-triple>`, e.g.
`bun-aarch64-apple-darwin`) at config-parse time, which happens inside
`build.rs`'s `tauri_build::build()`. Only `src-tauri/binaries/.gitignore` is
checked in, so a fresh checkout has no sidecar and a standalone
`cargo check` (or `cargo build`) run from `src-tauri/` fails.

Download the sidecar first:

```bash
pnpm --filter @yep-anywhere/desktop prepare-sidecar
```

This fetches the Bun binary for your host triple into `src-tauri/binaries/`
(idempotent — skips if already present). After that, Rust checks work:

```bash
cd packages/desktop/src-tauri
cargo check
```

The normal `pnpm tauri` / `beforeBuildCommand` / `beforeDevCommand` flows run
`prepare-sidecar` automatically, so this manual step is only needed when
invoking `cargo` directly.
