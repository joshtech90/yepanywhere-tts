# @yep-anywhere/desktop

Tauri desktop app for Yep Anywhere.

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
