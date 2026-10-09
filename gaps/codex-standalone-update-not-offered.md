# Yep Anywhere cannot update a standalone Codex CLI

On this host, `localhost:3400` detects Codex at
`~/.local/bin/codex`, which resolves into
`~/.codex/packages/standalone/current/bin/codex`. Before the user updated it,
the Codex update route reported `installed: 0.155.1`, `latest: 0.160.0`,
`updateAvailable: true`, `updateMethod: "manual"`, and no manual install command.
The installed CLI itself offers `codex update`, but Settings could neither run
it nor suggest it. Its generic hint says to update with ChatGPT or a package
manager, which is misleading for this installation.

`packages/server/src/services/CodexUpdateChecker.ts` only permits YA-owned
updates when it identifies an npm-global package; its manual command inference
recognizes Homebrew and Cargo, but not Codex's standalone installer. The
Settings panel in `packages/client/src/pages/settings/ProvidersSettings.tsx`
shows **Update now** only for `updateMethod: "npm"`. The copy is in
`packages/client/src/i18n/en.json` (`providersCodexUpdateManualInstallHint`).

Teach the updater to recognize the standalone installation and offer its
native `codex update` path. Run it within the existing provider-installation
coordination boundary, then verify that the production CLI reaches the target
version and invalidate Codex and Codex OSS catalogs as the npm path does.
Settings should show the actual update option for this install. Keep the
existing explicit update-policy choice and active-session safeguards described
in [provider installation updates](../topics/provider-installation-updates.md).

Found 2026-10-05 while investigating why Sol 6.1 was absent from the Codex
model picker. Recorded instead of implementing because the requested work was
to capture the gap and refresh the provider cache.
