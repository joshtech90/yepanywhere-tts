# Clone and fork session settings inheritance

Status: implemented and locally verified, 2026-10-02. The maintainer requested
this repair after confirming that Clone loses Codex Bypass and can reset
thinking/effort. The sections below retain the implementation plan; the
completion receipt records the delivered change and validation.

## Objective and existing context

Clone and ordinary prefix forks should start with the source session's current
permission mode, model, thinking/effort, and service tier on every provider that
implements a real transcript fork. Deliberate successor overrides win. The
child opens cold, with no new user turn, and retains those settings through its
first send and later server restarts.

This continues [clone/fork unification](075-session-fork-clone-unification.md),
which already establishes the cold-child behavior, retained provider/model,
completed-turn boundaries, sandbox inheritance, and unchanged source. Durable
configuration is owned by
[session defaults](../../topics/session-defaults.md#per-session-live-picks-vs-global-defaults),
the writable primitive by
[provider fork support](../../topics/provider-fork-support.md), and explicit
effort overrides by
[mid-session effort change](../../topics/mid-session-effort-change.md).
[Permission mode](../../topics/permission-mode.md) owns native policy mapping;
[session sandboxing](../../topics/session-sandboxing.md) owns the independent
host-confinement boundary.

The task/gap search found no existing settings-loss plan. The related open
[Codex cache gap](../../gaps/codex-cache-features.md) concerns the new thread's
cache identity and effort-change support; preserving settings does not resolve
that gap. The [rewind/fork gap](../../gaps/fork-is-the-only-rewind-and-changes-the-cache-key.md)
is separate work. The [roadmap](../roadmap/README.md) records this repair as
implemented alongside the existing release work.

## Diagnosis and baseline

- `SessionPage.cloneSession` sends `forkKind: "clone-latest-complete"` to
  `POST .../fork`, without a thinking override.
- That route records `effectiveLaunchSettings` only when `thinking` is supplied.
  An ordinary clone therefore lacks the source's complete durable snapshot.
- `CodexProvider.forkSessionWithLease` calls
  `mapPermissionModeToThreadPolicy(undefined)`, explicitly supplying the normal
  approval/workspace policy instead of the source's Bypass or Plan policy.
  `createThreadForkParams` also builds config from an empty settings object.
- Without a child snapshot, the client's established legacy resume mapping can
  send browser permission/thinking defaults as explicit request fields. These
  take precedence over any settings recovered from the copied transcript.
- The legacy `POST .../clone` route, still used by asides, also omits the launch
  snapshot. Restart/handoff already use `inheritSuccessorLaunchSettings`.

The read-only investigation checked `references/codex` against the pinned
`rust-v0.159.0` source. Its native fork can restore parent approval/permission
settings when overrides are absent; YA's explicit default policy defeats that
restoration. Removing those overrides alone would leave the metadata and
first-send problem unresolved.

Existing focused baseline: 13 tests passed across
`session-launch-inheritance.test.ts`, `sessions-fork-discovery.test.ts`, and
`sessions-clone-codex.test.ts`. They do not establish ordinary clone settings
preservation. `sessions-metadata.test.ts` already covers the explicit-thinking
fork path and should be extended rather than replaced.

## Intended behavior

| Setting | Ordinary clone or prefix fork | Deliberate override |
| --- | --- | --- |
| Permission mode | Retain the source's standing effective YA mode, including Bypass and Plan | Existing validated successor override wins |
| Model | Retain the existing inherited-model rule: preserve an explicit selection; pin a resolved source model when its selection was `default` | Preserve existing caller-specific model overrides |
| Thinking and effort | Retain both together, including intentional Off and provider-default values | Existing `thinking` fork option replaces the pair |
| Service tier | Retain the source's tier or intentional provider default | Preserve existing caller-specific tier overrides |
| Host sandbox and firewall | Retain the existing source boundary and project-private state behavior | This repair adds no boundary-changing override |
| Browser Show thinking and unsent composer choices | Keep their existing browser/session-local ownership | They are not provider launch inheritance |

The settings belong to the source at snapshot time, including for Fork before
or after a historical turn. Transcript cutoff and configuration inheritance are
separate decisions. Later changes to either session do not alter the other.
Providers without a real fork primitive remain unsupported; identical
inheritance rules do not imply identical native capabilities or effort labels.

The precedence is a validated caller override, then settled source settings,
then applicable legacy source evidence, then conservative server/provider
defaults. An intentional null in a complete snapshot means provider default,
not missing evidence to replace from browser storage. Unknown or ambiguous
legacy permissions never infer Bypass. Existing operator policy overrides and
provider/model capability restrictions remain authoritative.

### 1 — Capture source configuration through the existing session owner

Add a narrow server-owned snapshot operation alongside
`SessionActivationCoordinator`'s existing configuration ordering and cold-launch
recovery. Reuse the existing complete launch-settings value and
`inheritSuccessorLaunchSettings`; do not add a second settings database or a
browser-owned source of truth.

For an owned source, take the snapshot through its serialized configuration
queue after preceding accepted changes and pending snapshot writes settle.
Respect the existing two-clock semantics: permission mode is standing policy;
effort is the last applied value after the provider settles it. An unsent
browser choice or a failed provider update is not inherited. Existing Clone
and Fork-after busy rejection remains; this operation does not wait for an
active response or loosen transcript-boundary validation.

For a stopped source, use its durable snapshot. When it predates that snapshot,
reuse read-only provider recovery and YA's legacy requested-model precedence,
with existing conservative fallbacks. Do not activate the source or migrate its
metadata merely to inspect it. Recovery must respect reference-backed Codex
history and existing bounded readers rather than forcing a full transcript
scan. Apply inherited-model pinning before constructing the child snapshot.

Capture a coherent value before provider fork creation. Concurrent source
changes accepted afterward belong only to the source; they must not mix into
the child one field at a time. Source changes that fail persistence require
the existing pending-state retry path, not reuse of an older snapshot.

### 2 — Apply one inherited value to every child creation path

Route modern Clone, ordinary prefix forks, and the legacy aside clone through
shared source resolution and child-snapshot persistence. Audit every
`Supervisor.forkSession` caller, including restart-as-fork, recap, retitle,
fork-with-summary generators and final targets. Extend the internal provider
fork options with the resolved settings needed by a native fork; this is not a
new browser request contract.

Persist the child's complete `effectiveLaunchSettings` before reporting success,
using `recordEffectiveLaunchSettings` so the child has its own schema/revision
sequence. Keep provider, inherited model, executor, sandbox, creator and lineage
metadata consistent with the existing path. Store only the launch-settings
value, not the source revision, browser preferences, credentials, live queue,
or transient process state. Computer Control remains an explicit launch opt-in
and is not inherited.

Use explicit role-specific overrides for helper children. A low-effort summary
generator may use that effort; the final user-facing fork inherits the original
user session's settings, not the generator's temporary configuration. Capture
and carry the original settings across that job. Preserve existing deliberate
helper model/tier/effort choices and the long-context warning's thinking
override. No new public permission/model/tier fork fields are required.

Treat snapshot-write failure as creation failure: do not navigate or report a
successful child without durable settings. A provider may already have written
the child, so error copy must not falsely say no session was created. Retain
the actual child identity in diagnostics and use existing supported cleanup
only for that new child. A retry may create another child; this repair must not
silently delete an independently usable session or introduce a broad
idempotency protocol.

### 3 — Preserve settings in native provider forks

Codex must map the resolved inherited permission mode through its existing
coupled approval/sandbox policy helper, rather than mapping `undefined`.
Pass inherited model, service tier, and supported effort/config through the
native `thread/fork` request using the pinned protocol. Reuse existing effort
normalization and operator overrides; do not reinterpret YA's host sandbox as
Codex's native approval policy.

For Claude and Pi, durable transcript copying remains provider-native. Their
first resume must receive the same child snapshot from normal activation;
there is no need to spawn a source runtime to write provider policy into a file.
Keep immediate child discovery, completed-turn anchoring, sandbox transcript
locations, and provider-visible identity unchanged. Test Codex OSS where the
shared adapter exposes fork support. Future fork-capable providers should gain
the common inheritance behavior without another route-specific branch.

Recheck the pinned Codex Rust implementation before edits. This plan does not
request a version bump, enable experimental cache features, regenerate protocol
types, or enact a compatibility audit. If implementation reveals genuine
upstream compatibility work, follow the separate approval rule in
[provider development](../development/providers.md).

### 4 — Keep client restoration and hosted compatibility intact

Use the existing optional `session.effectiveLaunchSettings` response and current
`sessionResumeOverrides` behavior. No new endpoint, wire field, capability,
handshake, or elevated compatibility floor is planned. New clients on older
servers retain the existing field-absence fallback. An older client that sends
browser defaults as explicit overrides can still replace inherited settings;
the server must not disregard legitimate overrides to disguise that limitation.

Verify the unchanged client shows inherited permissions/thinking when the child
opens and sends no accidental default overrides on first send, retry,
reactivation, or existing-session Project Queue submission. Make a client edit
only if that evidence identifies an actual defect. Any new client dependence
requires the release-corpus review in
[server capabilities](../../topics/server-capabilities.md#minimum-compatibility-horizons)
and [hosted compatibility](../../topics/remote-hosted-compatibility.md).

Update the owning topic contracts when implementation lands. Replace the
current provider-fork and mid-session-effort text that ordinary forks use
browser defaults; document common inheritance, recovery, overrides, and failure
behavior. Until then, those topics retain their current-behavior descriptions.

### 5 — Verify first-send and restart behavior across providers

Add meaningful regression cases at the smallest boundary that observes each
failure. Route tests should create real child metadata with a source snapshot;
activation tests should assert provider launch arguments on the child's first
send and after reconstructing the metadata service/server owner.

| Check | Required evidence |
| --- | --- |
| Ordinary clone and both prefix intents | Claude, Codex and Pi retain source mode/model/thinking/effort/tier; source metadata and transcript stay unchanged |
| Permission changes | Bypass, Plan and Ask survive; tightening to Ask does not retain stale Bypass; existing Accept Edits/Auto capability behavior stays intact |
| Thinking values | Off, provider-default/null and an explicit effort survive, even when browser defaults differ |
| Explicit override | Fork-at-effort replaces thinking/effort only and retains source permissions/model/tier |
| Legacy source | Known source evidence is recovered; ambiguous permissions stay conservative; unknown effort is not invented |
| Helper paths | Aside, recap and summary helpers preserve deliberate overrides; final summary target retains the original user's configuration |
| Codex native request | Both approval and sandbox fields match inherited policy; model/tier/effort mapping uses the existing adapter rules |
| Persistence and concurrency | Settings survive a fresh metadata reader; queued changes produce a coherent snapshot; failed updates/writes never produce stale-success claims |
| Compatibility | Snapshot absence preserves old request mapping; snapshot presence omits implicit defaults while explicit Ask/Off still wins |

Use existing route, coordinator and client restoration suites. Add one focused
full-app browser check for Clone -> cold child controls -> first send with
conflicting browser defaults, rather than duplicating the provider matrix in
Playwright. Exercise real sequential typing during overlapping updates at the
expected fixture volume: zero dropped keystrokes and acknowledgement within
100 ms. Follow [E2E testing](../../topics/e2e-testing.md) for scope and
[UI testing](../../topics/ui-testing.md) for artifact presentation when captures
are produced. Use isolated project/test-browser infrastructure.

Required implementation checks are `pnpm lint`, `pnpm format:check`,
`pnpm typecheck`, and `pnpm test`, plus the focused affected browser cases.
Validate OS-sensitive provider/process/storage changes on Linux, macOS and
Windows or explicitly record unavailable platform evidence. Recheck immediate
fork discovery and sandbox inheritance alongside settings. Record focused
commands, actual outcomes and remaining limitations here at each checkpoint.

## Completion criteria

The repair is complete when a normal Clone and prefix fork on each supported
provider use the source's settings on first send and after restart, deliberate
overrides still work, source state is unchanged, and the owning topic contracts
match the verified behavior. The native Codex policy reset and browser-default
overwrite must both be covered by regressions.

## Completion receipt — 2026-10-02

The coordinator now snapshots live sources through their configuration queue,
retries pending persistence, and uses the last applied effort. Stopped sources
reuse existing durable settings and read-only legacy recovery. Model pinning
occurs within the coherent snapshot when a live default model is resolved.
The shared successor helper now lives in the supervisor layer.

`Supervisor.forkSession` resolves and persists a complete independent child
snapshot for every native fork. Modern Clone, prefix forks, restart-as-fork,
recap, retitle and summary paths use it; legacy Claude aside copies use the
same resolution and persistence. Multi-stage summary targets carry the
original frozen snapshot. Native Codex forks receive inherited permission
policy, model, service tier and normalized reasoning settings. No client
production change, public request field, capability or protocol update was
needed.

A failed child snapshot write returns an accurate creation error and logs the
actual child ID. The transcript remains discoverable as our own fork and its
claimed lineage ordinal is retained, since a child already exists. The source
configuration is unchanged; its existing fork counter still advances normally.

Validation ran on macOS with installed Node 24.19.0 LTS:

- `git pull --ff-only`: already up to date before implementation.
- `pnpm references:check`: pinned Codex reference aligned with `rust-v0.159.0`.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`: passed.
  The full server suite passed 6,293 tests and the client suite 6,634 tests;
  shared, relay, push-broker, desktop and mobile-core checks also passed.
- Focused server regression suites cover the three-provider settings matrix,
  first resume, a fresh server owner, native Codex policy, explicit overrides,
  legacy recovery/aside copying, queued source changes, immediate discovery,
  and accurate snapshot-write failure: 281 tests passed, two skipped.
- Focused Playwright cases `session-resume-settings.spec.ts` and
  `long-context-effort-warning.spec.ts`: passed. Clone opens cold with Bypass
  and High despite conflicting browser defaults, first send omits implicit
  overrides, explicit Ask/Off wins, and old-server field absence keeps the
  existing fallback. Real sequential typing during updates to a 900-message
  history lost no keystrokes; every acknowledgement was under 100 ms.
- `pnpm console:scan`: passed with unchanged logging budgets.

Browser checks use the isolated project harness and API fixtures; real
provider launch arguments and native JSON-RPC requests are verified by server
integration tests. Authenticated/billed live-provider runs and Linux/Windows
runs were not performed locally; those remain external platform evidence.
The documented [Node 26 loader warning](../../gaps/tsx-loader-deprecation-warning.md)
is unrelated and was avoided by using LTS for the final checks.
