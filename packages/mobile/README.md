# @yep-anywhere/mobile

Tauri mobile (Android / iOS) app for Yep Anywhere.

## Rust checks (`cargo check` / `cargo build`)

`src-tauri/tauri.conf.json` sets
`build.frontendDist: "../../../packages/client/dist-remote"`. This points at
the **remote** client build (intentionally — mobile loads the remote relay
client, not the local `dist`). That directory is generated, not checked in, so
a fresh checkout only has `packages/client/dist`. Tauri's `generate_context!`
macro resolves `frontendDist` at compile time and panics when the directory is
missing, so a standalone `cargo check` (or `cargo build`) from `src-tauri/`
fails until the remote frontend is built.

Build the remote frontend first:

```bash
pnpm --filter @yep-anywhere/mobile prepare-frontend
```

This runs the client `build:remote` and produces
`packages/client/dist-remote/`. After that, Rust checks work:

```bash
cd packages/mobile/src-tauri
cargo check
```

The normal `tauri android` / `tauri ios` dev and build scripts run
`prepare-frontend` automatically (see `package.json`), so this manual step is
only needed when invoking `cargo` directly.

> Do not change `frontendDist` to `../dist` — the remote build is required for
> the mobile relay client.
