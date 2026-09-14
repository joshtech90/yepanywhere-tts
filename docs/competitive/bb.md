# bb

- **GitHub:** [get-bb/bb](https://github.com/get-bb/bb)
- **Website:** [getbb.app](https://getbb.app)
- **Type:** Agent workbench: web + Electron desktop + host daemons + CLI/SDK;
  Expo mobile shell in early access
- **License:** MIT
- **Install:** `npx bb-app@latest`, or desktop downloads
- **Snapshot analyzed:** [`cf51227`](https://github.com/get-bb/bb/tree/cf51227e1135309a3c9c0baf5630be1ca7ba2714),
  2026-09-13; local checkout `references/bb`
- **Latest desktop release checked:** [0.43.1](https://github.com/get-bb/bb/releases/tag/desktop-v0.43.1),
  published 2026-09-12. The source snapshot includes subsequent work; source
  findings below are not claims that every feature shipped in that release.
- **Repository snapshot:** 3,594 stars, 466 forks, 414 open issues **including
  pull requests**, from the [GitHub API](https://api.github.com/repos/get-bb/bb)
  on 2026-09-13; 5,707 reachable commits, 34 plugin package manifests, and
  1,642 test/spec files excluding generated directories in the local checkout.
  These measure repository activity and scope, not active users or reliability.

## Assessment

**Competitive threat: high for agent orchestration and desktop development;
less proven for mobile supervision.** This is a judgment from the inspected
implementation and distribution evidence, not a hands-on product ranking.

bb's central proposition is that users and agents can extend the workbench
itself. Its plugins add UI panels, tools, commands, scheduling, providers, and
environment provisioning. The public positioning emphasizes customization and
programmatic delegation, with existing provider subscriptions supplying the
reasoning. The CLI and SDK make external scripts and personal bots potential
entry points into ordinary, inspectable bb threads. [Product site][site],
[package guide][package], [plugin SDK][plugins].

This makes bb closer to [T3 Code](t3code.md) than a terminal wrapper, but with a
stronger emphasis on an extensible automation platform. It is also a direct
competitor to YA: it runs multiple agents, exposes approvals and live history,
connects remote machines, forks conversations, and separates execution ownership
from the browser and API server. YA should not describe those capabilities as
unique against bb.

YA's clearest distinctions are its provider-native session catalog and history,
attention-tiered inbox, application-layer encrypted relay, supported native
Windows distribution, and deliberately narrow default authority over project
storage and agent behavior. bb is ahead in productized automation, general
plugin extensibility, managed environments, and integrated developer actions.

## Architecture and execution

```text
Web / Electron / mobile WebView / bb CLI / Node SDK
                         |
                  HTTP + WebSocket
                         |
                bb server + SQLite
                         |
               daemon WebSocket / RPC
                         |
          local or enrolled remote host daemon
                         |
                agent runtime / bridges
                         |
           Claude / Codex / Pi / ACP agents
```

Projects can have sources on multiple hosts. An environment binds a workspace
to a host and can be shared by threads. Threads own canonical bb events and may
have child threads; manager threads coordinate other work. The server owns the
SQLite representation, while host daemons provision environments and run
provider bridges. Public client and daemon contracts are separate packages.
[System overview][system], [runtime][runtime].

Provider bridges speak one JSON-RPC protocol and emit semantic deltas; the
shared runtime assembles bb timeline events. The plugin supplies the bridge
artifact and capabilities, keeping provider-specific protocol handling outside
the generic runtime. Claude, Codex, and Pi have dedicated plugins; five named
ACP entries are Cursor, OpenCode, omp, Grok Build, and Hermes Agent, with custom
ACP configuration as well. Capabilities vary: for example, Pi declares only
full-access permission mode, while ACP fork support varies by agent.
[Provider contract][provider-api], [ACP registry][acp], [Pi declaration][pi].

**Lifecycle overlap matters.** The packaged launcher manages the server and
local daemon independently and restarts a failed child without stopping the
other. A normal daemon/server WebSocket close clears connection state without
shutting down the runtime; the event sink queues delivery and retries when the
session is open. That supports continuity across a transient server outage at
the code level. Its event queue is an in-memory array, so it is not proof of
lossless recovery after daemon death. No live restart test was run for this
analysis. [Launcher contract][package], [connection implementation][connection],
[event sink][event-sink].

YA's corresponding [reload-safe runtime](../../topics/reload-safe-provider-runtimes.md)
has verified Linux/macOS Node source-checkout scope and fallback rules. Compare
actual recovery guarantees and distribution coverage; neither product should
receive an unqualified “survives every restart” checkmark.

## Feature comparison with Yep Anywhere

“Present” below means found in this bb source snapshot unless release evidence
is stated. “Not found” describes the reviewed surfaces, not proof of absence
from every third-party plugin. YA statements use current owning topics and the
[roadmap](../roadmap/README.md), rather than the February feature matrix.

| Area | bb | Yep Anywhere |
| --- | --- | --- |
| Agent breadth | Claude, Codex, Pi, five named ACP agents, custom ACP | Claude variants, Codex/OSS, Gemini, Grok, OpenCode, Pi; provider capabilities vary |
| Execution ownership | Host daemon owns bridges; browser may disconnect | Server-side provider ownership; supported durable provider host |
| Multiple execution machines | One server dispatches environments to enrolled hosts | Multiple YA servers; SSH Remote Executors currently limited to Claude-family adapters |
| Canonical history | bb SQLite threads/events with provider resume IDs | Provider-native transcript discovery, including sessions created outside YA |
| Conversation branching | Fork API, CLI and UI; checkpoint forks for Claude/Codex/Pi; some ACP agents support tip-only forks | Fork/clone from supported completed user turns |
| Cross-provider handoff | New thread with a source-thread mention and shared environment; present at snapshot HEAD | Provider-specific session identity and resume rules; no parity asserted for this exact handoff flow |
| Attention management | Nested threads, sections, unread/pending state and notifications | Dedicated Needs Attention → Active → Recent → Unread tiers across discovered sessions |
| Git inspection | Working-tree/branch/commit diffs and workspace status | Source Control: status, diffs, files, commits, blame and review comments |
| Git actions | Commit/push and PR operations through environment routes; GitHub plugin adds issue/PR dispatch | Explicit Pull/Push/Check; staging, committing, integration and conflict resolution remain agent work |
| Workspace isolation | Managed Git worktrees; setup/teardown hooks; environment plugins | Ordinary-clone workstreams are proposed, not implemented managed worktrees |
| Terminal and browser | PTY terminal routes; desktop browser and experimental browser-automation plugin | No equivalent general terminal/browser workbench established in this comparison; device/computer control has separate scope |
| Automation | Recurring/one-shot agent or script jobs; opt-in durable Workflows plugin | Project Queue exists; generally running yacron scheduler remains an open gap |
| Extensibility | Plugin SDK, catalog, UI slots, tools, commands, skills, providers and machines | Provider integrations and agent facilities; no comparable general workbench plugin SDK identified |
| Multiple accounts | Experimental Claude/Codex Account Pooler, including rotation on limits | Provider/profile variants; no equivalent automatic pool rotation claimed |
| Remote access | Account-gated bb connect proxy or trusted-network Tailscale Serve | Direct access and SRP + NaCl application-layer encrypted relay |
| Desktop platforms | Apple Silicon macOS downloads; Linux x64 AppImage alpha; Intel Mac via npm; Windows via WSL2 | Signed macOS and native Windows desktop releases, still beta; Linux server/web |
| Mobile | Responsive web + Expo native shell hosting the server web UI; iOS TestFlight advertised | Web/PWA; Android implementation and native Conversation preview; public store releases pending, iOS deferred |

Evidence: [runtime][runtime], [providers][acp], [fork implementation][fork],
[fork history][fork-history], [handoff][handoff], [Git routes][git],
[worktrees][worktrees], [automations][automations], [workflows][workflows],
[account pool][accounts], [multiple devices][devices], [mobile implementation][mobile],
[release notes][changelog]. YA: [inbox](../../topics/inbox.md),
[Source Control](../../topics/source-control.md),
[workstreams](../../topics/workstreams.md),
[remote-executor gap](../../gaps/provider-neutral-remote-executors.md),
[scheduler gap](../../gaps/yacron-scheduler.md), and
[roadmap](../roadmap/README.md).

## Where bb is particularly strong

### Plugins are the product architecture

The inspected tree contains 34 plugin packages, including providers, Connect,
Automations, Workflows, GitHub, Tasks, Docs, memory, editors and environment
providers. This is a source-package count, not 34 independent ecosystem vendors
or 34 enabled defaults. The SDK exposes backend and frontend contracts and
ships test harnesses for external plugins. Plugins can contribute commands and
tools alongside UI, so an integration can serve humans and agents together.
[Plugin tree][plugin-tree], [SDK][plugins].

The meaningful advantage is the extension loop: an agent can build an
integration that appears in its own workbench and teach other agents to use it.
YA would need a substantial product and compatibility commitment to match
that platform. It is not a small missing settings screen.

### Automation goes beyond cron

Automations stores jobs and run records, registers CLI/RPC handlers, reconciles
running jobs on startup, and sweeps due work. Its schedule helpers support cron
with time zones, alongside one-shot execution. The Workflows plugin is separate
and disabled on fresh installations: it runs orchestration JavaScript in
QuickJS and delegates reasoning to ordinary bb threads.
[Automations implementation][automations], [schedule helpers][schedules],
[Workflows contract][workflows].

Workflows persists runs and calls in its own SQLite store. On restart/resume it
re-evaluates the script, reuses the successful unchanged prefix of agent calls,
and executes from the first divergence. It provides bounded concurrency,
structured results, progress inspection and cancellation. Replay is restricted
to the same environment; completion notification is explicitly at-least-once.
These details make it useful prior art for durable orchestration without
implying exactly-once external effects. [Workflows][workflows].

### Workspaces and developer actions form a complete workflow

Managed worktrees come with copied local-file patterns, streamed setup output,
teardown, shared-environment ownership and cleanup. Archiving the last thread
starts a five-minute cleanup grace period; cleanup can terminate processes in
the workspace and forcibly remove uncommitted content. Committed branches
remain. That is a concrete automation-versus-retention tradeoff to compare with
YA's proposed long-lived lanes. [Worktree contract][worktrees].

The GitHub plugin uses `gh` authentication to bring issues and PRs into bb and
spawn linked agent work. Core environment routes also implement Git and PR
actions. The optional experimental Modal plugin provisions reusable machines
and supports idle pause and filesystem restoration. Cloud execution is
therefore implemented as an extension, with external infrastructure and
credentials required; it is not the default execution model.
[GitHub plugin][github-plugin], [Git routes][git], [Modal plugin][modal].

## Privacy and authority boundaries

**bb connect is an authenticated proxy, not YA-style application-layer E2E.**
Its Cloudflare Durable Object reads HTTP method/path/headers, pumps request
bodies, and frames visitor WebSocket payloads into tunnel messages. This is
positive source evidence that the relay can access application traffic; TLS
and account gating do not hide that traffic from the proxy operator. The
local server defaults to loopback, and bb documents its public API as
unauthenticated when exposed directly. Tailscale Serve supplies a separate
network access boundary. This is an architecture comparison, not a
vulnerability assessment. [Tunnel implementation][tunnel], [access guide][devices].

YA's [connection matrix](../project/connection-matrix.md) and
[relay design](../project/relay-design.md) describe SRP authentication and NaCl
encryption between client and server. That remains a meaningful reason to
choose YA for private remote supervision.

Plugin trust must also be described precisely. bb calls frontend content
scripts trusted same-origin page code. The QuickJS sandbox limits workflow
code's capabilities; it is not a sandbox for every plugin or for the agents
that workflows launch. Enabling a broad extension platform is a different
trust decision from viewing existing provider sessions. [SDK][plugins],
[Workflows][workflows].

bb's production README documents usage telemetry with a random installation ID
and an opt-out; push sends thread titles and short previews through Expo. These
are concrete data-flow choices, not evidence that all session content leaves
the machine. [README][readme], [push contract][devices]. YA's
[app-data-only storage](../../topics/project-directory-storage.md) and
[vanilla defaults](../../topics/vanilla-defaults.md) provide useful contrasting
product contracts. Both products can attach existing checkouts; bb's managed
workspaces are an explicit workflow and should not be described as unavoidable
project mutation.

### Hosted login and admission authority

bb has the convenient account-to-machine flow discussed for YA. Its hosted
[dashboard](https://getbb.app/dashboard) offers GitHub login, and the reviewed
Better Auth configuration enables GitHub as its sole social provider. Email
and password login is a development option; Google is not configured in this
snapshot. This login is separate from agent-provider authentication.
[Auth configuration][connect-auth].

The account owns server records. A server redeems a one-use pairing code for
a server credential and tunnel URL, then opens an outbound tunnel. The hosted
Cloudflare worker authenticates that tunnel credential and admits browser
requests only when the session account matches the destination's owner.
Desktop/mobile and host clients can instead enroll with machine codes and
receive revocable machine credentials. The API machine-credential path checks
account ownership and rejects host-management mutations. These are centrally
issued account/machine credentials, not project/session capability grants.
[Enrollment API][connect-api], [proxy authorization][connect-worker].

Consequently, the hosted service is both the access gate and the application
traffic proxy. It has authority to admit clients to the paired server; it is
not merely a directory returning an address. The reviewed browser and machine
checks enforce same-account ownership, not invitations for a second user with
read/write roles. In particular, the machine credential check is account-wide,
not restricted to the server URL returned during enrollment. Local/direct use
has a separate network boundary, as described above. This is a simpler model
than T3's cloud-signed request followed by local credential issuance, with
different trust and policy placement.

## Distribution and evidence limits

Desktop 0.43.1 has Apple Silicon DMG/ZIP and Linux x64 AppImage assets. The
README labels Linux alpha and directs Windows users to WSL2; native Windows is
not a supported bb host path. npm and nightly channels also exist.
[Release][release], [README][readme].

**The mobile documentation disagrees with itself.** `docs/platform-support.md`
still describes a native transcript client, unavailable plugin frontends and
source-only distribution. `apps/mobile/README.md` and the current screen tree
instead describe a native shell around the server web app, with native pairing,
notifications and device settings. The 0.43.0 changelog advertises an iOS
TestFlight link. Use the implementation and newer release evidence for this
snapshot: WebView shell, iOS early access advertised, no verified public
App Store/Play release. The TestFlight page could not be retrieved during this
review, so enrollment availability was not independently verified. Android
build/test coverage is not established by this inspection.
[Older platform guide][platform], [mobile README][mobile],
[WebView screen][webview], [changelog][changelog].

No app, provider sessions, cloud sandboxes, or upstream tests were run. Test
file counts show investment in verification, not passing results. There is no
measured performance, mobile polish, security audit, active-user estimate or
market-share claim here. Managed Connect pricing/limits were not independently
established; free MIT source does not establish hosted-service pricing.

## Implications for YA

This research does not reprioritize the [roadmap](../roadmap/README.md): public
app distribution and continuous delivery remain first. `tasks/` was absent;
the relevant existing plans and gaps below were checked before deriving these
implications.

1. **Keep the differentiation specific.** Lead with private remote supervision,
   provider-native history and attention management. Forks, daemon execution,
   multiple providers and remote access are shared with bb. Its broad automation
   surface is a real advantage; generic “we supervise agents” positioning will
   not explain why someone should choose YA.
2. **Use bb as prior art for the existing scheduling direction.** Its run
   records, restart reconciliation, cancellation and observable workflows are
   relevant to [yacron](../../topics/yacron.md) and the
   [open scheduler gap](../../gaps/yacron-scheduler.md). They do not remove the
   management-UI prerequisite or authorize another scheduler implementation.
3. **Compare multi-machine outcomes, not a boolean feature.** bb has explicit
   host/environment routing and server-matched daemon distribution. YA's
   [simple-client demo](../tactical/130-simple-client-api-and-three-client-demo.md)
   addresses multiple servers, while the
   [remote-executor gap](../../gaps/provider-neutral-remote-executors.md)
   records a different, provider-limited dispatch path.
4. **Preserve the chosen workspace and source-control direction.** Evaluate
   bb's cleanup and setup contracts when refining
   [workstreams](../../topics/workstreams.md); ordinary lane clones remain
   YA's proposed model. YA already has substantial
   [Source Control](../../topics/source-control.md). The remaining
   [commit/session attribution gap](../../gaps/committed-change-session-attribution.md)
   is more precise than an obsolete “no Git support” comparison.
5. **Track extensibility as a strategic choice.** A general plugin SDK and
   durable workflow engine would expand YA's scope materially. Revisit only
   when concrete integrations repeatedly need it; use the existing
   [agent command runtime](../../topics/agent-self.md) as current context.

Revisit this analysis when bb publishes mobile store builds, changes Connect's
trust model, adds provider-native external-history discovery, supports native
Windows, or graduates its experimental account/machine plugins. Those would
change the comparison more than a larger raw feature count.

## Sources

All source links below are pinned to the analyzed commit. Public website,
release and repository metrics were checked on 2026-09-13.

[site]: https://getbb.app
[release]: https://github.com/get-bb/bb/releases/tag/desktop-v0.43.1
[readme]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/README.md
[package]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/packages/bb-app/README.md
[system]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/docs/system-overview.md
[runtime]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/packages/agent-runtime/README.md
[provider-api]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/docs/provider-plugin-api.md
[acp]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/plugins/provider-acp/src/known-agents.ts
[pi]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/plugins/provider-pi/src/declaration.ts
[plugins]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/packages/plugin-sdk/README.md
[connection]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/host-daemon/src/server-connection.ts
[event-sink]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/host-daemon/src/event-sink.ts
[fork]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/server/src/services/threads/thread-fork.ts
[fork-history]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/server/src/services/threads/thread-fork-history.ts
[handoff]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/packages/client-core/src/prompt/thread-handoff-request.ts
[git]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/server/src/routes/environments.ts
[worktrees]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/docs/worktrees.md
[automations]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/plugins/automations/src/server.ts
[schedules]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/plugins/automations/src/schedule-helpers.ts
[workflows]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/plugins/workflows/README.md
[accounts]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/plugins/account-pool/package.json
[devices]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/docs/multiple-devices.md
[mobile]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/mobile/README.md
[changelog]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/CHANGELOG.md
[github-plugin]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/plugins/github/README.md
[modal]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/plugins/environment-modal-sandbox/README.md
[tunnel]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/connect/src/tunnel-do.ts
[connect-auth]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/web/src/server/auth.ts
[connect-api]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/web/src/server/api.ts
[connect-worker]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/connect/src/worker.ts
[platform]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/docs/platform-support.md
[webview]: https://github.com/get-bb/bb/blob/cf51227e1135309a3c9c0baf5630be1ca7ba2714/apps/mobile/src/screens/webview/ProfileWebViewScreen.tsx
[plugin-tree]: https://github.com/get-bb/bb/tree/cf51227e1135309a3c9c0baf5630be1ca7ba2714/plugins
