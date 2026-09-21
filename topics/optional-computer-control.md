# Optional Computer Control

Topic: optional-computer-control

Status: Windows Node/Codex local preview accepted, 2026-09-12. Signed-package
lifecycle, real deferred discovery, independent fixture effects, live/reloaded
browser images and candidate crash isolation pass. Managed release download and
update code is implemented; first published-release and packaged-distribution
acceptance remain pending.
Implementation and release gates are tracked in
[Tactical 131](../docs/tactical/131-optional-windows-computer-control.md).

## Managed release installation and updates

Enable Computer Control downloads the latest compatible stable Windows release
from `kzahel/machine-control` on the YA server, verifies it, installs into the
owned per-user instance, health-checks the runtime and stops it before reporting
ready. It then enables explicit session selection. Installation does not grant
access to existing sessions. OS/architecture selection is server-side; Windows
Node x64/ARM64 and an ordinary interactive desktop are required.

YA pins Machine Control's minisign public key and authenticates `release.json`
before trusting its publisher, names, sizes or SHA-256 hashes. Bounded downloads
go into unique YA-data staging directories; archive names, entries, expanded
size and complete bytes are checked before native installation. Size and hash
are measured on the received stream, so the staged archive must receive every
byte of every chunk; a write that stores less than it was handed fails the
download rather than leaving a short archive to verify against the stream. The signed
manager/catalog verification remains mandatory. Download failure, invalid
signatures or incompatibility leave the existing installation unchanged.
The installed version is persisted and older release-feed versions are refused.
A persisted installed version that is not a released `x.y.z` version — settings
are hand-editable JSON — is ignored with a logged warning and reported as no
installed version, so status and update checks keep working instead of failing
on every comparison; the next successful install records a usable version again.

Check for updates is explicit and available while disabled. Managed installs
also check on enabled startup and every 24 hours while automatic updates are
enabled. The automatic-update preference defaults on within this explicitly
enabled component and can be turned off. No recurring work runs while disabled.
Advanced local installs default to manual updates; opting into automatic
updates explicitly migrates them to the signed public release stream.
Checks coalesce. Updates wait until all computer-control grants are gone;
checking/downloading blocks new selection briefly, and never revokes existing
grants to make room. Installation checks readiness before committing the new
version. Failure restores the previous signed package; failed recovery disables
the feature and retains an installation locator for retry/removal. Interrupted
updates preserve the persisted previous locator for recovery on next use.

The settings view shows enable, installed version, update availability,
automatic-update preference and uninstall. Local package/publisher input is
collapsed under Advanced. Download progress is polled only while an operation
is running and the view is mounted. Cancel/disable aborts acquisition, waits
for owned management cleanup, removes grants and stops the helper. Uninstall
also removes the managed native instance. Retry starts a fresh verified download.

Optional capability ID 71, `computer-control-releases`, covers the new
`POST /api/computer-control/releases/check`, `POST .../update`,
`PUT .../enabled` (`enabled`) and `PUT .../automatic` (`autoUpdate`) routes and
the additive `release` status. The 2026-09-12 reviewed stable corpus is v0.8.0
and v0.8.1; neither contains these routes. Absent ID 71, the client shows server
update guidance and retains ID 70 local-install controls without calling any
release route. Absent ID 70, it makes no computer-control requests at all.
Old clients retain the original local-install API; ID 70 keeps its meaning.

After publication, run
`pnpm --filter server exec tsx --conditions source scripts/computer-control-release-acceptance.ts`
in an interactive Windows Node session. This creates an isolated native instance,
downloads from the real public feed, exercises read-only native enumeration and
restart from the managed copy, then disables/uninstalls. It retains no desktop
content. Until that succeeds, mocked browser/download tests and native ZIP tests
are implementation evidence, not public-release acceptance.

## Implemented Windows native/session contract

Computer Control settings are stored in YA server settings. Installation and
global enablement are separate from an explicit session selection, which is
never saved as a session default or restored as authority after a restart.
Unselected sessions receive no computer tool definitions or grants and create
no resident, guardian, JavaScript evaluator or computer-specific worker.
Selected sessions register one deferred typed `computer_control` tool with
Codex 0.154.0 through `thread/start.dynamicTools`. Existing Code Mode discovery
exposes it; actual calls return through `item/tool/call` on the same provider
connection. This feature does not register an MCP server or use SSH.
The deferred function is registered inside the `yep_computer` namespace, as
required by the pinned App Server validator. Calls from any other namespace
are refused. A rejected thread start is terminal for that provider session;
YA must not leave a dead provider in-turn or treat queued input as dispatched.
`packages/server/scripts/computer-control-codex-probe.ts` checks the actual
pinned CLI with an ephemeral thread and no model turn: the original flat
registration must be rejected and the adapter's namespaced registration must
start successfully. The probe uses a fresh unauthenticated Codex home.
The implementation reference is `references/codex` at `rust-v0.154.0`
(`6b9826e3aa83b1a5947db50f4332cb9c65f1b340`), particularly the App Server
dynamic-tool contract and `core/src/tools/handlers/dynamic.rs`. Provider
versions and generated protocol schemas are unchanged.

Eligibility requires Windows, the Node YA runtime, local Codex execution, no
YA session sandbox, an installed authenticated preview, global enablement and
explicit selection when starting/creating the session. Other operating systems,
Bun, providers and executors are unavailable. Grants expire after 30 minutes
by default (operator API range 10 seconds to one hour). They are scoped to the
selected provider thread: child threads, revoked grants and aborted sessions
cannot dispatch. A launch whose provider start fails releases its grant before
the failure reaches the caller, so a session that never began holds none of the
32 concurrent grants until expiry. An agent with unrelated unsandboxed same-user shell access is
not contained by these grants; this is a computer-tool authority boundary.

For Advanced local import, the operator selects an extracted workstation package
and supplies its publisher from an independently trusted source. YA verifies
the manager's timestamped Authenticode signature and exact publisher before
executing any imported script. The signed manager then verifies the existing
Machine Control inventory, hashes, catalog and native signatures. No unsigned
override exists. The managed per-user package path and publisher are persisted;
each cold start revalidates the complete package. Archive self-asserted hashes
or publishers alone do not establish trust. Managed releases use the separately
authenticated release manifest described above.
Removing the original extracted import folder must not break cold startup or
uninstall. Failed uninstall leaves the feature disabled and retains the installed
manager locator and publisher so the operator can retry removal.

The first actual operation lazily launches a dedicated Medium user resident.
Its identity includes the current user SID, interactive Windows session and
YA data-directory-derived instance. Startup attests the exact launched PID,
instance, session, workstation profile, Medium integrity, readiness and native
generation. Direct newline JSON IPC uses only that user's named pipe; no
appliance fallback, arbitrary provider dispatch or SYSTEM authority is exposed.
The appliance's installation, ProgramData and services remain independent.
Privileged unlock and its separate signed component are outside this slice.

The desktop surface includes window enumeration, bounded semantic snapshots,
screenshots, semantic invoke/value setting, click/key/text input, activation
and non-closing window state changes. Unknown fields are refused. Snapshots
are limited to depth 12 and 500 elements; text to 4096 characters; responses
to 2 MiB with a 15-second operation deadline. Mutations require a generation
observed by that session, and semantic references must come from its latest
snapshot. Unknown, stale and cross-session references fail before dispatch.
The native runtime additionally validates its own generations and references.

Only one desktop operation runs at a time across at most 32 grants. Busy calls
are refused without dispatch; they are not queued. Each grant accepts at most
2048 distinct provider call IDs; duplicate IDs are refused, never replayed.
Connection acquisition may wait before a write. A disconnect, malformed reply
or timeout after writing is unknown delivery and is never automatically retried.
Native provider, fidelity, delivery, effect and uncertainty remain in results;
confirmed delivery is not independent proof of a desktop effect. Revocation
during an in-flight operation withholds desktop data while preserving known
delivery/effect metadata and the need to inspect effects independently. An
operation runs against the resident it was dispatched to: a stop that releases
the resident mid-call neither fails that operation nor skips its activity
refresh, and the observation it returns still authorizes the grant's later
references.

Native screenshot reads accept only exact artifact IDs under the owned
instance/session directory, reject links/path substitution and validate PNG
identity, extent, SHA-256 and dimensions. Reads are bounded to 8 MiB,
16384 pixels per dimension and 64 megapixels. Model results contain normalized
image content; the existing YA tool-result media pipeline handles live and
persisted images with its own storage/retention settings.

Inactivity stops the resident after 60 seconds by default (operator range
5–240 seconds); an operation near expiry refreshes the deadline. A later call
can cold-start again, but previous observations/references lose authority.
Session close, expiry and revocation remove grants; the last grant releases
the resident. Disable revokes all grants and stops the resident. Re-enabling
does not revive old grants. Operator status supports explicit refresh without
an idle polling loop.

A YA-owned launcher creates the native process suspended, assigns it to a
private Windows Job Object with kill-on-close, then resumes it. Descendant
provider processes inherit the job. The guardian refreshes its five-minute
inactivity deadline on operation activity; parent disconnect starts bounded
native shutdown, with launcher termination as fallback. Resident crash,
launcher crash and owner EOF reclaim the owned descendants. Stop confirmation
has a 12-second deadline; failure is reported rather than called a successful
cleanup. Unrelated processes and the appliance tree are outside this job.

Authenticated operator routes are `GET /api/computer-control`,
`PUT /api/computer-control/settings`, `POST /api/computer-control/install`,
`POST /api/computer-control/stop`, `DELETE /api/computer-control/installation`
and `DELETE /api/computer-control/sessions/:sessionId`. Settings PUT requires
`enabled`, `idleMs` and `grantMs`; install requires `packageDirectory` and
`trustedPublisher`. Session start/create accepts optional `computerControl`.
These frontend operations do not expose an agent HTTP execution endpoint.
Permanent optional capability ID 70, `optional-computer-control`, gates all
new client requests and launch fields. Missing support hides selection and
shows an unavailable settings deep link without requesting the new routes.

The repeatable candidate runner is `scripts/start-computer-control-candidate.ps1`;
it requires a built client and serves those assets in production mode, without
a Vite process. The native acceptance script is
`packages/server/scripts/computer-control-native-acceptance.ts`. Credentials,
machine-specific run contracts and captured desktop data stay outside commits.
Native source changes are not required by the current Job Object ownership
implementation. Signed-payload acceptance is separate from native source tests.

## Accepted Windows scope

Acceptance covers source-run Node YA with Codex 0.154.0 on an interactive
Windows ARM64 desktop, reaching the authenticated local preview over the user's
named pipe. It is not acceptance of a packaged YA executable, Bun, x64 YA
integration, other providers, macOS/Linux control, public download/update feeds
or privileged unlock settings; the broad Windows aggregate gates remain open in
[the Windows validation gap](../gaps/windows-validation-baseline.md).
The run record is in
[Tactical 131](../docs/tactical/131-optional-windows-computer-control.md).

## Intended experience and ownership

**Decision:** Computer control is an optional installed capability, default-off
and available only to eligible, authorized sessions. Installing or globally
enabling the component must not load its full instructions, start a worker, or
register a computer-control MCP server in every provider session. The requested
experience resembles Computer Use: discover a small capability description,
load its instructions when needed, and start the actual control machinery on
first use.

The primary deployment places YA, the agent execution environment, and the
Machine Control resident on the same machine. Use direct local IPC for that
path. A remote testbed transport is useful for validation but must not become
the mandatory product route.

Machine Control owns signed native packages, providers, the typed desktop
contract, generation checks, and optional privileged unlock enforcement. YA
owns installation controls, supervision, session eligibility and authority,
agent-facing advertisement, and result presentation. Existing Machine Control
CLI/appliance use must remain independent of YA. Unlock retains its separate
native installation, UAC approval, grant, and credential-custody flow.

**Decision:** Reach the resident through the provider's deferred dynamic tool
(vs. a bundled SDK or CLI driving a supervised persistent JavaScript worker):
Codex's namespaced registration already dispatches over the existing provider
connection to direct local IPC, so the worker candidate would have added a
general JavaScript evaluator — which is not same-user containment — for no
reachable capability. A provider without that hook still needs its own proven
adapter, and an MCP adapter remains optional.

This is an optional out-of-process native component, not a proposal to reopen
the banked general-purpose [server plugin architecture](server-plugin-arch.md).
Launch-time delivery and defaults belong to
[new-session agent tooling](new-session-agent-tooling.md); the existing
[agent command runtime](agent-command-runtime.sketches.md) remains a possible
CLI entry point.

## What the MCP experiment established

**Current evidence:** A separate YA server with temporary provider profiles
exposed four small MCP tools over authenticated, stateless Streamable HTTP.
Real Codex and Claude sessions discovered tool definitions, performed one
semantic Windows fixture action each, and consumed screenshot image results.
Independent fixture state confirmed the effects. No YA provider or resident
source changes were needed. Stale generations, unknown references and revoked
credentials were refused. The temporary processes, profiles and VM workspace
were cleaned up.

The controller and YA ran on macOS; Windows control went through the common
testbed CLI and SSH to the signed user resident. Tool calls took approximately
8–60 seconds. Cua became unhealthy and native UIA/PrintWindow fallbacks supplied
the accepted actions and captures. These are remote testbed measurements,
not local IPC performance or successful Cua-health acceptance.

**Limit:** Providers were explicitly configured with the MCP URL in their
temporary profiles. Lazy tool-schema discovery did not prove lazy process
startup, session-selective availability, or dynamic attachment to an already
running session. Model/transcript image acceptance also did not establish YA
browser rendering acceptance. The experiment is evidence for a possible adapter,
not a decision to make MCP the required product integration.

Exact versions and execution findings live in the
[Machine Control spike](../../machine-control-spike/docs/ya-computer-mcp-findings.md).
Native package ownership and acceptance live in Machine Control's
[distribution topic](../../machine-control/topics/native-distribution.md).

## Codex and Sky reference mechanics

**Observed installed implementation:** The application bundle serving the
investigated session contained Node 24.19.0, a persistent `node_repl` executable,
and `@oai/sky` version `0.6.17-202608171537-pr-1300023-7efba775c041`. The runtime
was under the ChatGPT app bundle; do not generalize that physical packaging to
every Codex desktop release.

The installed Computer Use skill supplies `import("@oai/sky")` explicitly. The
package is already in the host's module environment; the agent does not invent
its path or install it from npm on each use. The observed sequence is:

1. The agent sees the small skill description and reads the full API instructions
   when the task needs computer control.
2. The agent submits JavaScript to the host-provided persistent Node REPL.
3. Importing Sky sets up a proxy through `nodeRepl.rpc("sky", ...)`; the trusted
   service dispatches the SDK operations.
4. The Mac SDK lazily imports its native client on the first computer operation.
   A request creates/reuses the native transport.
5. The transport tries a local socket. If unavailable, it requests
   `ensureService` for `computer-use` through host services, or falls back to
   macOS Launch Services to start the installed service.
6. The native connection uses length-prefixed JSON-RPC with typed requests and
   a version handshake. Text and explicitly emitted screenshots return through
   tool results to the model.

Reinspection paths, relative to the installed `@oai/sky` package:
`package.json`, `dist/project/cua/sky_js/src/sky.js`, `service.js`, and
`targets/mac/{lazy-client,client,native-pipe}.js` under that same source directory.
These are distributed implementation observations, not a claim that Sky is an
open-source library available for redistribution.

**Current public-source evidence:** The audited Codex checkout was
[`ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8`](https://github.com/openai/codex/tree/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8).
Keep these execution layers distinct:

| Layer | Mechanism and evidence |
| --- | --- |
| Rust agent and App Server | The agent owns conversation/tool dispatch. A UI or supervisor connects through bidirectional JSON-RPC. The public repository includes this engine and protocol, not the complete desktop/Sky implementation. |
| Code Mode | JavaScript for orchestrating tool calls; current `codex-rs/code-mode-runtime/src/runtime/mod.rs` creates V8 runtimes. This is not the persistent Node package environment. |
| External Node REPL | Current `codex-rs/protocol/src/mcp.rs` recognizes `node_repl` and `cua_repl` tools. The installed skill/SDK use this persistent environment for Sky. Those hooks do not establish the desktop's exact process-launch implementation. |
| Historical built-in JS REPL | The older Rust implementation spawned a Node child with a kernel script and piped stdin/stdout, with configured module directories and lazy initialization. It was removed by commit `8a559e7938` on 2026-04-24. Do not describe that historical code as current desktop wiring. |

The installed Computer Use plugin also registered a launcher invoking
`SkyComputerUseClient mcp`. Therefore the observed distribution contains MCP
plumbing even though the SDK-to-native control connection uses separate local
IPC. The exact current desktop ownership and startup timing of the Node worker
were not established by inspecting the public repository.

The [App Server documentation](https://learn.chatgpt.com/docs/app-server)
also describes experimental `dynamicTools` and the `item/tool/call` exchange:
a client can implement tools and return content, including images, over its
existing Codex connection. YA now uses this hook for the preview described
above; that does not establish that Sky uses the same hook.

## Agreed development and validation placement

**Decision:** Develop the next Windows slice in a native Windows development
session, with YA and Machine Control checkouts inside a claimed isolated VM
workspace. Local editing, builds and tests avoid a repeated Mac-to-Windows copy
cycle and exercise the intended same-machine deployment.

The controller first runs Machine Control's doctor and acquires the workspace
and exclusive claim. A Windows YA server owns the development session. The
controller may reach its authenticated loopback API through an SSH port forward
to create the session, observe events and send guidance. SSH carries supervision,
deployment and independent diagnostics; agent computer-control calls under test
must use local IPC inside Windows. The controller retains independent Machine
Control access for verification and recovery.

The requested development model is **GPT-6 Astra with high reasoning**. Resolve
and verify the Windows provider's actual model ID and reasoning support before
launch; do not silently substitute another model or effort level.

Commit the instructions, findings and relevant source before handoff. Push
repositories with configured remotes and check out recorded commits in Windows.
A local-only experiment repository may travel as a committed Git bundle or
tracked-source archive instead; verify its commit or digest after transfer.
Do not copy local authentication, inventory, grants, captures, ignored caches or
the controller's dependency directories into the source handoff.

Use a separate temporary YA profile for acceptance sessions. Check ordinary
sessions create no computer-control worker, authorized first use starts it,
reuse does not multiply workers, and disable/revocation/idle cleanup work.
Exercise real discovery, semantic action and screenshot consumption with an
independent fixture effect check. After local development, repeat acceptance
against exact signed CI artifacts without a source checkout. Release all test
sessions, profiles and the VM workspace when finished.
