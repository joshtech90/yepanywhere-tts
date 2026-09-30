# Dependency maintenance

[Contributor guide](../../DEVELOPMENT.md) · [Development docs](README.md)

Commands and code paths below are relative to the repository root unless stated
otherwise.

## Dependency Security Maintenance

CI runs `pnpm audit --prod` on every pull request and push to `main` (the
`audit` job in `ci.yml`) and it must exit 0. Pay special attention to the
`web-push -> asn1.js -> bn.js` chain.
Keep `bn.js` patched (currently via pnpm override) until `web-push` ships an
upstream fix.

When a transitive dep has no direct upgrade path, prefer a pnpm override. Pin it
exactly if a newer major would escape the parent's declared range — `fast-uri`
is pinned to `3.1.8` rather than `^3.1.8` because 4.x is published and `ajv`
declares `^3.0.1`. When the parent's declared range already contains the patched
version, no override is needed: refresh the lockfile with
`pnpm -r update <pkg> --depth=Infinity` (plain `pnpm update` skips transitive
deps). That refresh can leave a stale transitive copy in place and bump the
direct dependents instead: `jsdom@25` (client tests only) stayed on
`ws@8.19.0`, inside two `ws` advisories, although its `^8.18.0` range admits
the patched 8.21. The scoped `"jsdom>ws": "^8.21.3"` override moves only that
edge. Drop it when a newer jsdom resolves a patched `ws` without it.

The 2026-09-29 audit refresh moves `fast-uri` to 3.1.7 and the MCP SDK's
`express-rate-limit -> ip-address` edge to 10.7.2 (within its `^10.2.0`
range). This resolves GHSA-qw65-cvwx-89v3, GHSA-58mr-gqgx-xq4g,
GHSA-rpw4-54j3-4h4q, and GHSA-2vr4-cq9g-pvrc without new audit exclusions.

During the 2026-09-30 CI isolation campaign, the unchanged lockfile's audit
began reporting four additional advisories. The existing exact `fast-uri`
override moves to [3.1.8](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj),
and the Firestore `minimatch` edge resolves `brace-expansion` to 2.1.7 within
its declared 2.x range. That release fixes
[nested recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7),
[comma recursion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p), and
[quadratic expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr).
No new audit exclusions are added; unrelated resolutions remain unchanged.

### Install-script allowlist

Dependency install scripts (preinstall/install/postinstall) are blocked by
default via `onlyBuiltDependencies` in `pnpm-workspace.yaml`; only
`bcrypt` may run its native build. Relay and push broker used to add
`better-sqlite3` here; they now use the runtime's built-in SQLite through
`@yep-anywhere/shared/sqlite`, so the repository has no SQLite addon to build
or ignore and needs no compiler on any host.
This neutralizes the `"preinstall": "node setup.mjs"` vector used
by npm supply-chain attacks. If a newly added dep needs its build script,
`pnpm install` warns `build scripts that were ignored: <pkg>` and the
package will be missing its native binary at runtime — vet the script,
then add the package name to the allowlist. Blocked today, each verified
a no-op with no performance fallback: `esbuild` (native binary ships via
`@esbuild/*` optional deps; the postinstall only swaps the bin shim, and
there is no silent WASM fallback), `@firebase/util` (bakes
`FIREBASE_WEBAPP_CONFIG` into web-SDK defaults; unset here), `protobufjs`
(prints a version-scheme warning).

### Known-unreachable advisories

Advisories triaged as unreachable are suppressed via
`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`; that list and this
table must stay in sync — every ignored GHSA needs a row here, and removing a
row means removing the ignore. As of 2026-09-26 two advisories are triaged as
unreachable with no fix compatible with YA's current dependency and runtime
constraints. Re-check when the listed trigger fires rather than re-deriving the
analysis:

| Advisory | Why unreachable | Revisit when |
|---|---|---|
| `react-router` RSC-mode CSRF (GHSA-qwww-vcr4-c8h2) | Client is SPA-only — `BrowserRouter`/`Routes`, no `createBrowserRouter`, RSC, or server actions | Migrating to react-router v8. The fix lands in 8.3.0 and `react-router-dom` never reaches it (v8 consolidated into `react-router`) |
| `uuid` buffer bounds (GHSA-w5hq-g745-h8pq) | Only path is `firebase-admin -> @google-cloud/storage -> gaxios@6`, which calls `uuid.v4()` with no arguments; the defect needs v3/v5/v6 with a caller-supplied `buf`. Patched only in `>=11.1.1`, outside gaxios 6's `^9` range | `firebase-admin`/`gaxios` declare uuid `>=11`, or a 9.x patch release appears |

Anything not on this list is untriaged — treat a new advisory as actionable.

`ignoreGhsas` only quiets `pnpm audit`. GitHub's Dependabot alerts for the
same advisories are dismissed per alert, as "vulnerable code not used", with
a comment pointing here. Dependabot also scans manifests outside pnpm; these
advisories were triaged as not applying and dismissed the same way on
2026-09-28:

| Advisory | Manifest | Why it does not apply | Revisit when |
|---|---|---|---|
| `accelerate` sharded-checkpoint path traversal (GHSA-4j2p-28q2-5m79) | `requirements/stt-known-good-2026-06-16.txt` | The affected functions are `load_checkpoint_in_model` and `load_checkpoint_and_dispatch`. YA's speech workers load models by operator-configured id through `from_pretrained` and never call either function | A speech worker loads raw accelerate checkpoints, or a patched release lands (then bump the pin) |
| `torch` `torch.jit.script` memory corruption (GHSA-rrmf-rvhw-rf47) | same snapshot | Needs crafted input to `torch.jit.script` on the local host; YA only runs inference and never scripts code | Moving the snapshot to torch ≥ 2.13, which also frees the setuptools pin |
| `setuptools` sdist MANIFEST.in bypass (GHSA-h35f-9h28-mq5c) | same snapshot | Affects building sdists on macOS filesystems. The snapshot is a Linux runtime env, and `torch==2.12.0` requires `setuptools<82`, so the patched 83 cannot be pinned | Same torch move |
| `pytorch-lightning` `load_from_checkpoint` pickle loading (GHSA-75m9-98v2-hjpm) | `requirements/stt-nemo.txt` | NeMo 2.0.0 needs `pytorch-lightning==2.4.0`. The NeMo worker loads through `ASRModel.from_pretrained`, never `LightningModule.load_from_checkpoint`. The current NeMo env (`stt-nemo-recent.txt`) resolves 2.6.5 | Retiring the in-place NeMo 2.0.0 add-on |
| `glib` `VariantStrIter` unsoundness (GHSA-wrw7-89jp-8q8g) | `packages/desktop/src-tauri/Cargo.lock` | gtk-rs 0.18 is the last GTK3 binding and Tauri's Linux backend requires it, so no patched `glib` is reachable. Neither the desktop crate nor its Tauri/GTK dependencies iterate string-array variants | Tauri moves its Linux backend off gtk-rs 0.18 |
| `rand` unsound with a custom logger (GHSA-cq8v-f236-94qc) | same `Cargo.lock` | `rand 0.7.3` is used only by `phf_generator` during the build. The defect requires a custom `log` logger that itself draws random numbers | `phf_generator` moves off rand 0.7 |

The patched Python pins in that snapshot (`anyio`, `msgpack`, `pip`) were
dry-run resolved against the live `stt` env before they were committed.

## Automated Dependency Updates

The hosted Mend Renovate app proposes updates from `renovate.json`, using
GitHub's Dependabot alerts and OSV as advisory sources. Dependabot security
and version updates stay off so the same bump never arrives twice. Update
PRs open weekly, at most five at a time, after a release is 3 days old;
security fixes skip both waits. The Dependency Dashboard issue lists
everything pending.

- Renovate automerges only non-major devDependency updates at 1.0 or later
  and non-major GitHub Actions updates and digest pins. Everything else waits
  for review.
- `platformAutomerge` is off: `main` has no required status checks, so
  GitHub's native automerge could merge a PR with failing checks. Renovate
  merges only after every check on the branch passes.
- Workflow runtime inputs (`node-version`, `go-version`, `toolchain`,
  `java-version`) are not updated; CI deliberately runs at the supported
  Node floor.
- Major updates to `pnpm-workspace.yaml` overrides are disabled; see the
  exact `fast-uri` pin above.
- `@anthropic-ai/claude-agent-sdk` and the pixi STT environment update
  only when requested from the dashboard, because they follow the
  [provider refresh](../../topics/provider-refresh.md) audit and the
  known-good STT snapshot respectively.

Before changing `renovate.json`, run
`npx --package=renovate -- renovate-config-validator --strict`.
