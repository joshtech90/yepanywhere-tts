# Happy

Research snapshot: **2026-10-17**. Replaces the 2026-02-03 mobile/CLI review.
Evidence is current official documentation, public source, release notes,
Google Play listings, and GitHub metadata. No app installation, two-user
deployment, crash-rate measurement, or Android reliability test was performed.

- **Website:** https://happy.engineering/
- **Type:** Desktop app, headless agent runtime, and iOS/Android/web clients
- **Pricing/license:** Free core, existing provider subscriptions, MIT; adapted
  Grok portions retain Apache-2.0 notices. Mobile voice has a paid allowance.
- **Current entry point:** Happy Desktop for macOS, Windows, or Linux;
  `brew install --cask slopus/tap/happy` on supported Homebrew platforms.
- **Legacy entry point:** `npm install -g happy`, then `happy claude` or
  `happy codex`. The original CLI is in maintenance mode, with critical fixes;
  new product features ship in Desktop. The mobile app supports both paths.

Sources: [Welcome][welcome], [quick start][quick-start], [original CLI][legacy],
[licensing][agent-repo], [voice pricing and direction][vision].

## Shift from mobile remote to a unified harness

Happy now owns the agent loop, tools, permissions, sandbox, durable sessions,
and client protocol. Desktop and the phone app are clients of Happy Agent,
a headless daemon that can run locally or on a server. Closing Desktop does
not stop the daemon's sessions; the execution host must remain awake and
online. Persisted sessions can resume after a daemon restart. This does not
mean a process continues executing through a machine shutdown.
Managed workspaces isolate parallel work in Git worktrees. [Welcome][welcome].

The new Codex path implements Codex-style behavior inside Happy rather than
wrapping the Codex CLI. Claude uses the official Agent SDK for inference,
with Happy supplying its tool/session behavior. Grok adapts Grok Build's
contracts. Vendor-shaped prompts and tools share Happy's surrounding runtime;
the claim of native behavior is not evidence that the upstream CLI runs
unchanged or that every upstream feature has parity.

This is a different architectural choice from YA's supervision of
provider-owned runtimes and provider-native history. It gives Happy control
over mixed-model delegation, agent messaging, durable scheduling, and one
permission boundary, while making Happy responsible for maintaining the
recreated behavior. [How it works][how], [runtime overview][agent-repo],
[architecture][architecture].

The persistent **Chief of Staff** configures providers, imports projects,
pairs phones, deploys servers, and creates specialized bots. Its source
prompt also directs it to preserve context across conversations and follow
up on delegated responsibilities. The broader vision is one primary agent
coordinating other agents, with agent-maintained documents and generated
interfaces replacing parts of the growing chat log. That destination is
direction, not a claim that every part is shipped.
[Chief of Staff][chief], [source prompt][chief-source], [vision][vision].

## Source and release boundaries

| Repository | Ownership |
| --- | --- |
| [slopus/happy][happy-repo] | iOS/Android/web app, original CLI, encrypted relay; its internal `happy-agent` package is legacy remote control, not the new runtime |
| [slopus/happy-desktop][desktop-repo] | Electron/React desktop client |
| [slopus/happy-agent][agent-repo] | New headless runtime, providers, tools, persistence, and collaboration |
| [slopus/slopus.github.io][site-repo] | Website and product documentation |

| Release | Observed change |
| --- | --- |
| Desktop 0.0.96, October 11 | Generated web artifacts can be shared apps with persistent data and live updates. |
| Desktop 0.0.97, October 12 | Latest stable Desktop at review time; inline generated images, presented files/videos/PDFs, and artifact cards. |
| Desktop 0.0.98-preview.5, October 14 | Preview, not stable; rendering/navigation refinements and remote USB, Bluetooth, and port connections. |
| Agent 0.4.99, October 16 | Latest stable runtime at review time; collaborative rich-text documents with merged edits, presence/cursors, and attributed permanent history. Editing requires a sufficiently current client. |

Sources: [0.0.96][desktop-96], [0.0.97][desktop-97],
[0.0.98 preview][desktop-preview], [0.4.99][agent-99].

The runtime's current source also implements **Surfaces**: shared documents,
todo lists, and references to bots, tasks, and artifacts. A Surface can own
a shared agent conversation. Documents use Yjs and BlockNote. Current Desktop
source has collaborative-document integration newer than stable 0.0.97;
the runtime release does not establish that every installed desktop or
mobile client exposes that editor. [Surfaces source][surfaces],
[Desktop source][desktop-repo], [client requirement][agent-99].

## Android and mobile access

Happy still ships an Android app on [Google Play][happy-play] and an iOS app.
These are mobile interfaces to the same runtime sessions, not desktop screen
streaming. QR pairing connects the phone through Happy's application-layer
encrypted relay. Desktop reaches a remote runtime through Tailcat instead;
the two remote paths should not be conflated. The original CLI and Desktop
can appear as separate machines in the same phone account.

Documented phone functions include starting/continuing sessions, text and
image prompts, notifications, permission/question answers, stopping turns,
model/effort/access-mode selection, file reads, and Git-change review.
The mobile changelog also records bot creation, voice, live subagent
rendering, project grouping, and cross-device drafts. These establish a
substantial mobile product, not full desktop feature parity. In particular,
the newest collaborative document editor was not verified in shipped Android.
[Mobile documentation][mobile], [mobile changelog][mobile-changelog].

The execution machine must be online to do new work. A server deployment
allows work to continue while the user's laptop sleeps; the phone can also
read already synchronized encrypted history when that server is offline.
[Remote server guide][remote].

## Human multiplayer is implemented, with broad shared authority

Team mode runs one self-hosted Happy Agent for a WorkOS organization.
Members sign in as themselves, share projects/tasks/sessions, and can send
messages into shared agent conversations. The agent is told the speaker's
name and email when the speaker changes. Drafts and task-list ordering stay
personal, and each member can pair a phone.

The documented limits matter as much as the multiplayer label:

- Access is broadly shared; there are no per-session invitations.
- Provider sign-ins belong to the server's service account. Members spend
  those accounts' quotas, not their individual subscriptions.
- Any member can switch a session to Full access. Named identity does not
  establish per-person isolation of the execution environment.
- Setup is multi-step and driven through the Chief of Staff/recipes.
  The docs explicitly say a remove-member action has not been built.
- Giving someone a personal installation's API token is a separate,
  single-identity sharing path; it is not team-mode attribution.

This is real shared-conversation multiplayer for mutually trusted people,
not evidence of fine-grained guest grants or mature team administration.
[Multiplayer docs][multiplayer], [team deployment contract][team-mode].
See also [the multiplayer landscape](multiplayer-ai.md).

## Android adoption and project health versus T3 Code

The following is a dated public snapshot, not an active-user or crash-rate
comparison. Google Play downloads are cumulative brackets. Scores below
are from the US-requested listings' aggregate JSON-LD metadata; the rendered
score can vary by country/device. Rating counts are not written-review counts.

| Android signal | Happy | T3 Code |
| --- | --- | --- |
| Google Play downloads | 10,000+ | 10,000+ |
| Aggregate rating | Approximately 4.97/5 | Approximately 4.33/5 |
| Rating count | 3,229 | 40 |
| Listed last update | 2026-10-03 | 2026-10-15 |

Sources: [Happy Play listing][happy-play], [T3 Play listing][t3-play].
Neither listing establishes monthly active users or retention. Happy has a
much deeper Android rating history; T3's small rating sample cannot support
a confident reliability ranking. T3's site separately claims over 500,000
developers across its product, without defining this as Android users or
monthly active users. [T3 website][t3-site].

| GitHub repository | Stars | Forks | Open issues | Open PRs |
| --- | --- | --- | --- | --- |
| [slopus/happy][happy-repo] | 24,188 | 2,069 | 656 | 416 |
| [slopus/happy-desktop][desktop-repo] | 94 | 24 | 20 | 16 |
| [slopus/happy-agent][agent-repo] | 32 | 16 | 7 | 24 |
| [pingdotgg/t3code][t3-repo] | 28,056 | 7,508 | 1,473 | 1,461 |

Counts were read from GitHub's repository/pull-request APIs. Issues exclude
PRs: the API's `open_issues_count` includes both, so the open PR count was
subtracted. These are repository-wide counts, not Android defect counts.
Stars and forks are interest/contribution signals, not users. Happy's
established monorepo footprint does not establish adoption of the newer
runtime, and its split repositories make raw activity comparisons imperfect.
Both projects had repository activity on October 16–17.

Recent Android reports show unfinished core interaction work in both apps:

- Happy [#1900][happy-1900] reports a misplaced composer after notification
  entry; [#1901][happy-1901] reports duplicate session screens after repeated
  notification taps. Both describe an Android 16 Play build on a Galaxy S25
  Ultra, were filed October 14, and were open with no comments at review time.
- Happy [#1888][happy-1888] reports Windows/Android linking confusion across
  the old CLI and new desktop integration; it is not proof of a general
  Android transport failure.
- T3 [#19278][t3-freeze] includes reports from several Android devices/builds
  of unresponsive navigation or a stalled UI while opening/loading/running
  threads. A proposed fix, [#19292][t3-freeze-fix], was open and unmerged.
  The reports do not independently establish the root cause or a shipped fix.
- T3 [#18688][t3-question] reports unusable pending-question rendering on
  mobile 1.4.0. Maintainer triage disputes part of the description and requests
  screenshots/current-build evidence; treat it as an unresolved report.

Open issues are reports, not measured incidence. More issues can reflect
more users, wider scope, or better reporting; closure can mean duplication
or missing information rather than a repair. No side-by-side device test or
Android crash/ANR telemetry was available for this review.

## Comparison with Yep Anywhere and T3 Code

Happy remains a direct competitor for encrypted mobile supervision, durable
sessions, multi-session control, and remote execution. It also now competes
as a unified execution harness and a collaborative agent workspace.

The February comparison's server-owned-process and worktree absence claims
are obsolete. Native mobile apps and voice also should not be treated as
blanket YA implementation absences; distinguish supported public store
distribution from local implementations using the [roadmap][roadmap].

YA's meaningful architectural distinction is preservation/discovery of
provider-native history and supervision of provider-owned runtimes, alongside
its inbox and private authenticated relay. Happy takes responsibility for
the surrounding execution behavior itself. Its architecture still identifies
provider-session forking as unimplemented; do not confuse old CLI branching
features with support in the new harness. [Architecture limits][architecture].

Against T3, Happy has the deeper Android rating history and a distinctive
combination of encrypted mobile sync, persistent bots, and human team mode.
T3 has the larger public development ecosystem and a broader integrated
files/terminal/Git/PR workflow, including native mobile PR reviews in its
October release. That breadth is not proof of higher Android reliability.
[T3 follow-up](t3code.md#october-17-follow-up-android-health-and-adoption),
[T3 Android release][t3-play]. These findings do not reprioritize YA work.

[welcome]: https://happy.engineering/welcome/
[quick-start]: https://happy.engineering/quick-start/
[legacy]: https://happy.engineering/docs/
[vision]: https://happy.engineering/vision/
[how]: https://happy.engineering/how-it-works/
[chief]: https://happy.engineering/chief-of-staff/
[chief-source]: https://github.com/slopus/happy-agent/blob/c798cd910d951350adfd09d389312a1ad7b16e0d/packages/happy-agent-modules/sources/bots/impl/formatChiefOfStaffInstructions.ts
[happy-repo]: https://github.com/slopus/happy
[desktop-repo]: https://github.com/slopus/happy-desktop
[agent-repo]: https://github.com/slopus/happy-agent
[site-repo]: https://github.com/slopus/slopus.github.io
[architecture]: https://github.com/slopus/happy-agent/blob/c798cd910d951350adfd09d389312a1ad7b16e0d/docs/architecture.md
[desktop-96]: https://github.com/slopus/happy-desktop/releases/tag/v0.0.96
[desktop-97]: https://github.com/slopus/happy-desktop/releases/tag/v0.0.97
[desktop-preview]: https://github.com/slopus/happy-desktop/releases/tag/v0.0.98-preview.5
[agent-99]: https://github.com/slopus/happy-agent/releases/tag/v0.4.99
[surfaces]: https://github.com/slopus/happy-agent/tree/c798cd910d951350adfd09d389312a1ad7b16e0d/packages/happy-agent-modules/sources/surfaces
[mobile]: https://happy.engineering/mobile/
[mobile-changelog]: https://github.com/slopus/happy/blob/main/packages/happy-app/CHANGELOG.md
[remote]: https://happy.engineering/guides/remote-server/
[multiplayer]: https://happy.engineering/multiplayer/
[team-mode]: https://github.com/slopus/happy-agent/blob/c798cd910d951350adfd09d389312a1ad7b16e0d/docs/team-mode.md
[happy-play]: https://play.google.com/store/apps/details?id=com.ex3ndr.happy&hl=en&gl=US
[t3-play]: https://play.google.com/store/apps/details?id=com.t3tools.t3code&hl=en&gl=US
[t3-site]: https://t3.codes/
[t3-repo]: https://github.com/pingdotgg/t3code
[happy-1900]: https://github.com/slopus/happy/issues/1900
[happy-1901]: https://github.com/slopus/happy/issues/1901
[happy-1888]: https://github.com/slopus/happy/issues/1888
[t3-freeze]: https://github.com/pingdotgg/t3code/issues/19278
[t3-freeze-fix]: https://github.com/pingdotgg/t3code/pull/19292
[t3-question]: https://github.com/pingdotgg/t3code/issues/18688
[roadmap]: ../roadmap/README.md
