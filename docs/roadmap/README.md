# Roadmap

Last updated: 2026-10-04.

This is Yep Anywhere's canonical product-priority overview. Keep initiative
status, the next action, and major blockers here; keep implementation steps in
`docs/tactical/` and durable behavior contracts in `topics/`. Planning stays in
the repository and does not require epics, ticket numbers, or pull requests.

## 1. Publish the desktop and mobile apps with continuous delivery

**Highest priority.** Make Yep Anywhere available as supported public releases
on desktop, iOS, and Android, with CI covering every distribution and a
**Latest** channel for bleeding-edge builds. Android internal releases are
explicitly requested; desktop Latest publication remains automatic. Desktop
should graduate from its current beta positioning; mobile should reach the
App Store and Google Play, not stop at internal testing.

**Status:** in progress. Mobile release direction selected 2026-09-30:
bundled web UI as the primary foreground, with native login, host selection,
secure SRP/session storage, transport, reconnect, and notifications. Android
now opens the complete bundled UI through its native authenticated transport,
with native host management and no duplicate dashboard/Conversation screens.
The implementation and acceptance evidence are recorded in
[the WebView app plan](../tactical/083-android-bundled-web-native-transport.md).
Native dashboard/Conversation rendering and the experimental Simple Client API
preview are no longer mobile release prerequisites. iOS follows the same shell
boundary; the [iOS/shared-core plan](../tactical/138-ios-native-core-proof.md)
has passed its Rust crypto interoperability and native build experiment,
including iOS simulator execution. A Daybreak Blue engineering review supports
the proof and conditional development use of SRP 0.7; the plan records its
production login gates and accepted limits. The maintainer accepted the shared
Rust core with pinned SRP 0.7.0-rc.3 and unchanged-server compatibility. The
consumer iOS 17+ shell now runs the bundled UI over native Rust SRP,
with Keychain storage, continuity-key registration/check-in/revocation and
foreground lifecycle reconstruction. Owned simulator acceptance covers real
native login, concurrent streaming/typing within 100 ms, route/draft preservation
and Switch Host. Direct/mux/legacy server probes and an unsigned device build
pass, including OS TLS trust/hostname/expiry checks and cancellation across FFI.
Dedicated iOS CI runs independently of physical-device signing. The
[hosted source run 36926705262](https://github.com/kzahel/yepanywhere/actions/runs/36926705262)
passed all 18 simulator tests without skips, including native login, streamed
typing, foreground/relaunch draft preservation and Switch Host, then linked the
unsigned ARM device app. Typing acknowledged all 37 characters with a 26 ms
maximum, zero drops and 342 overlapping transcript mutations. The
[main CI run](https://github.com/kzahel/yepanywhere/actions/runs/36926705404)
passed all 24 jobs and 361 browser cases without retries.
CI uses macOS 15 Apple Silicon / Xcode 26.3 with iOS 18.6, compiles before
simulator boot, and requires CPU/memory headroom before UI acceptance. Its owned
simulator uses a verified background-service profile; local runs remain stock
by default. The Darwin sampler reports available and free memory separately.
Automatic XCTest recording is disabled while six explicit screenshots remain.
Native shell checks use control identifiers, and restored WebKit controls use
current-frame taps. Intel native tests also pass with their Rust simulator
target, but Intel UI remained CPU-bound. The 18 tests and 100 ms typing ceiling
remain intact. Initial physical-phone acceptance also passes: 15 native and both
UI tests on iPhone SE (3rd generation), iOS 26.6.1, with development signing and installation.
Typing peaks at 33 ms over 37 keys, with zero drops and 226 concurrent transcript
mutations; foreground/relaunch and Switch Host pass. Store signing/publication,
tablet acceptance and the broader device/network matrix remain release work.
Embedded viewers/downloads need the
[remaining WebKit adapters](../../gaps/ios-webview-viewers-and-downloads.md).
Native per-host push enrollment and presentation are implemented. The updated
broker is deployed; physical Android acceptance proves foreground/background
FCM, two-host isolation, authenticated session taps and headless presentation.
The iOS sandbox Firebase/APNs setup and signed push provisioning are configured.
Two-host enrollment and real background Apple delivery pass; live notification
tap routing remains under validation in the
[native push plan](../tactical/141-native-push-delivery.md). The maintainer
prioritized [Android/shared transport migration](../tactical/139-shared-mobile-transport-migration.md)
on 2026-10-02. That implementation now uses Rust/UniFFI in Android and common
per-profile source leases on iOS. Shared mux circuits, credential-proven route
fallback, scoped ownership and final teardown pass unchanged-server tests.
Android's R8-minified physical Pixel proof includes two hosts on one relay socket
and a 100 MiB upload with 16.6 ms peak typing latency. iOS simulator acceptance
and the physical iPhone native/UI suites pass; the updated physical typing proof
records 37 inputs, zero drops, 19 ms peak and 294 concurrent mutations.
Release builds and required local checks pass. Store publication, remaining native push acceptance and
the viewer/download gap remain the next mobile release work.

### Current baseline

- Signed macOS and Windows desktop releases already exist. The
  [desktop release QA log](../testing/desktop-release-qa-log.md) records
  installer and updater validation; the
  [public distribution catalog](../../site/src/data/distributions.ts) still
  identifies desktop as beta.
  October 3 fixes move update feedback into AppKit/Windows native controls,
  route local Settings to that controller, and use the immutable bundled server
  version. Host macOS native checks and browser regressions pass; Windows native
  interaction, install/relaunch and the reported hours-idle history remain
  acceptance work before desktop graduation. See the QA log for boundaries.
- The web client and npm server are available. The
  [Latest remote-client workflow](../../.github/workflows/latest-remote-client.yml)
  already deploys the exact successful CI commit after pushes to `main`.
- [Desktop CI](../../.github/workflows/desktop-ci.yml) packages and signs
  desktop releases. [Nightly Desktop](../../.github/workflows/nightly-desktop.yml)
  publishes verified `main` changes to Latest; the first signed nightlies and
  the unchanged-source skip have passed release validation. September 30
  verification repaired stale filtered-run discovery and prevents selecting
  source behind an already published Latest. The selector now reads the workflow
  inventory and filters main pushes locally. Forward-source
  [nightly 36715214551](https://github.com/kzahel/yepanywhere/actions/runs/36715214551)
  published `0.3.2701` at verified `2d2f524d5`, with both macOS installers
  notarized, Windows signing successful and all updater signatures verified.
  The earlier draft-creation 403 did not recur with the existing permissions.
- The website's [desktop downloads page](../tactical/134-desktop-download-links.md)
  is live in `site-v1.11.0`. It suggests the visitor's platform and links to
  current Stable macOS and Windows installers through the update server;
  nightly builds remain separate.
- The [server runtime matrix](https://github.com/kzahel/yepanywhere/actions/runs/34485119811)
  now passes full packaged startup on Linux, macOS and Windows across all four
  Node versions and the pinned Bun runtime, including clean npm installations.
- [Android CI](../../.github/workflows/android-app-ci.yml) tests and builds
  application artifacts, including a bundled Release AAB. A dependent internal
  publishing job requires a manual main dispatch with `publish_internal=true`,
  then handles versioning, exact-artifact signing and stale-run protection.
  Push/nightly verification does not publish and cancels superseded checks;
  explicit releases finish independently of later pushes. Dedicated Google
  OIDC federation and app-scoped Play testing permissions are verified end to end.
  [Hosted run 37202914083](https://github.com/kzahel/yepanywhere/actions/runs/37202914083)
  passed both Android gates and published `0.1.2-ci.464.1` (56401), confirmed
  **Available to internal testers**. The signed bundle matches the tested
  candidate and retained receipt; main browser CI also passed. Neither native
  mobile app is publicly published.
- Both mobile store records have saved initial metadata. Local uploads now
  use platform-managed final signing: Android's upload-signed AAB passes Play
  internal-release validation, and Xcode uploaded the first iOS archive to
  internal-only TestFlight. Android 0.1.0 is now active for the selected internal
  testers, with its opt-in page verified. iOS build 1 shows Ready to Test after
  completing encryption compliance with France excluded from availability.
  October 4 fixes Android's UI-initiated public TLS login failure: 0.1.1
  (1001) is published and available to internal testers, with Main/public-relay
  and isolated production-R8 Release login acceptance on a physical Pixel.
  Android 0.1.2 (1002) is now available to internal testers with host-switch
  resume and WebView inset fixes; the Play password association is verified.
  Retesting the updated Google Play-signed install remains open.
  French classification/filing is deferred before enabling that market; iOS
  tester enrollment and production iOS push remain open. Android internal
  release delivery is available on explicit request; iOS release automation
  remains open. See [mobile store preparation](../distribution/mobile/README.md).
- Native app CI now runs on relevant platform, shared mobile-core and packaging
  changes rather than ordinary web/server edits. Daily Android/iOS acceptance
  and the existing desktop nightly retain full shared-source coverage; manual
  checks remain available. See [the cadence policy](../development/testing.md#native-app-ci-cadence).
- Linux remains supported through the server/web distribution. The current
  desktop installer matrix is macOS and Windows; a Linux desktop installer
  would need its own scope and release criteria.

### Release outcomes

- [ ] Establish and meet desktop release criteria, then publish and present
  desktop as a supported release rather than beta. Reuse existing signed
  installer and updater evidence instead of restarting the packaging work.
- [x] Decide the first mobile release scope and its acceptance criteria.
  Native shell/full bundled web UI selected; tactical 083 records the gates.
- [ ] Complete and publish Android on Google Play and iOS on the App Store.
  Automated internal testing is an intermediate milestone, not completion.
- [ ] Give every distribution CI verification and automated release delivery:
  website/web client, npm server, desktop, Android, and iOS. Extend existing
  workflows rather than creating a parallel release system.
- [ ] Publish passing, relevant `main` changes to Latest channels without a
  manual version bump, release tag, or upload for each preview build. Include
  signed desktop updates and internal TestFlight. Android internal testing
  instead uses explicit manual release requests, selected by the maintainer
  on October 4. Broader mobile testing must respect platform review and
  distribution rules.
- [ ] Make each platform's latest available build easy to find, with its
  version, source commit, publication state, and installation path. A failed
  or still-processing build leaves the previous successful build available.

### Latest channel expectations

Desktop starts with nightly publication at 02:37 UTC, skipping unchanged
packaged inputs, plus manual dispatch for recovery and validation. Same-app
Stable/Latest selection and signed nightly publication are available. Windows
installed-upgrade acceptance passed, including channel persistence and data
preservation. The macOS VM resumed normally on 2026-09-28, clearing the earlier
suspended-state restore blocker. Installed macOS upgrade acceptance remains
pending; the manual-check regression was reproduced and locally fixed. See the
[desktop release QA log](../testing/desktop-release-qa-log.md).
Continuous per-commit desktop delivery remains a later extension of this
foundation.

Continuous publication should make builds available as soon as verification,
packaging, signing, and platform processing allow; it is not restricted to a
nightly schedule. Coalesce superseded pending work when necessary instead of
building an ever-growing release queue. Store availability and device update
timing are separate; hourly automatic installation is not a guarantee.

Desktop discovers the available update and offers it through a banner or
equivalent notice. The user approves installation through one Update action;
publication must not silently install or restart the desktop app. Mobile
installation follows the user's platform update preferences.

Stable and Latest remain distinct choices. Latest clients must preserve the
supported older-server fallbacks; joining Latest must not require upgrading
every paired machine together. Versioning, signing, installation, update, and
compatibility checks belong to the release criteria, not just compilation.

### Mobile scope decisions and next action

The 2026-09-30 direction uses the full bundled web interface for ordinary
projects, sessions, transcripts, input and settings. Android owns native login,
reauthentication, host selection, protected SRP/resume credentials, transport,
reconnect and notifications. Saved-host selection enters the web app directly;
Switch Host returns to native management. Management observes connection state
without retaining dashboard subscriptions. The approved
[Android tabs and warm-resume work](../tactical/146-android-tabs-and-warm-resume.md)
adds a native top toolbar and internal-only tabs while preserving the selected
WebView through ordinary multitasking. Implementation and Pixel acceptance are
complete: direct/two-host relay, public-relay radio loss, launcher resume,
rotation, tab/link routing and typing during 100 MiB upload are verified.

The initial mobile release uses server-owner login. Native limited-user login
is explicitly deferred (2026-10-01). Android and the iOS native-login/transport
shell are implemented; iOS has owned simulator, unsigned-device and signed
physical-phone acceptance evidence.

The [WebView app implementation](../tactical/083-android-bundled-web-native-transport.md)
reuses the existing native pairing and multi-host core and the web client's
SourceTransport contract. It adds no server authentication protocol or child
credential. The duplicate native dashboard and Conversation presentation are
removed, with reusable decoder/projection helpers retained.

The [Simple Client API experiment](../tactical/130-simple-client-api-and-three-client-demo.md)
remains separate work: the generated contracts and deliberate-entry web preview
are useful independently, but native Conversation UI and SourceOverview are
not mobile release prerequisites. The previous native preview remains
historical evidence in Git.

**Next action:** finish store signing/distribution, notification enrollment and
tap acceptance, and release-device/network checks for both mobile apps. The
[Android offline recovery repair](../testing/android-offline-recovery-investigation.md)
keeps cold pages navigable and recovers in place; physical Pixel/public-relay
radio-loss and launcher-reopening checks pass locally. Complete
the iOS embedded-viewer/download adapters before claiming full UI parity; a new
SwiftUI transcript/composer design is not required. Desktop release and
continuous-delivery work continue independently.

## Later directions

The [clone and fork settings repair](../tactical/140-clone-session-settings-inheritance.md)
is implemented and locally verified as of 2026-10-02. It preserves source
permissions, model, thinking/effort and service tier across supported providers.
Shared source snapshotting, child persistence, native Codex policy and
first-send/restart behavior have regression coverage. Workspace and focused
browser checks passed on macOS; Linux/Windows evidence remains external.

The separately authorized [project-template implementation](../tactical/132-project-template-implementation.md)
now has a native library composer and opt-in settings for ordered GitHub/local
sources, pinned retrieval and manual updates. Production creation, ready-content
admission and limited-user template grants with project-confined setup are
implemented. Personal-workspace scopes, retained App access, reservations and
project-local identity remain pending. The three default templates are admitted.
The [project service specification](../../topics/project-service.md) now defines
main-pane App access, standardized serving/lifecycle declarations, conditional
vhost association in project Settings and audit-preserving personal removal;
its mockup does not implement those runtime contracts.
This work does not displace release delivery above.

The separately authorized
[Machine Control desktop consumer](../tactical/142-machine-control-desktop-consumer.md)
is complete as of 2026-10-03. Verified discovery and default-off session selection
consume MC's installed Python CLI, sharing discovery with independent native
sudo. Mac/Windows actual Codex native/browser use, live/reloaded media and
close/restart/crash isolation pass; Linux x64 installed CLI/core desktop use
passes its bounded slice. YA's former Windows component installer, updater,
resident supervisor and product controls are retired with bounded compatibility
refusal and exact-instance cleanup. Remaining provider/platform cells are listed
in the owning [topic](../../topics/optional-computer-control.md). This separately
authorized work does not displace release delivery above.

These remain candidates behind publishing and continuous delivery, not a
ranked or approved implementation queue. Recheck current code and owning
documents before defining work.

The maintainer authorized the
[Agent Auth Router integration](../tactical/143-agent-auth-router-integration.md)
on 2026-10-03. Its manual first slice is implemented in both repositories:
private local pairing, granted account catalogs/quotas, native Claude/Codex
transport overrides and durable same-account pins. Live adapter creation,
continuation and resume passed with temporary YA profiles; full YA HTTP
restart/resume and tool approval also passed. The
[owning topic](../../topics/agent-auth-router.md) records setup and boundaries.
The authorized recovery follow-up adds on-demand reachability, disabled-account
guidance and explicit cancellation/disconnect retry before automatic policies.
AAR owns the SHA-pinned cross-repository regression suite for both providers.
Manual/Round robin allocation and a cached quota/eligibility overview are
implemented. YA respects router-owned pool grants and exposes read-only
management guidance; legacy routers retain their scoped editor. Advanced
balancing, clone/helper inheritance, Windows and constrained sandbox support
remain later work. On 2026-10-03 the maintainer deferred the next
[refresh/admission, Most remaining and inheritance follow-ups](../../topics/agent-auth-router.md#deferred-follow-ups);
they remain recorded candidates. Durable OAuth renewal and cross-account
continuation remain unverified. The maintainer subsequently selected
[router-owned pools, live accounts/grants and a Tauri desktop app](https://github.com/kzahel/agent-auth-router/blob/main/docs/router-owned-pools-and-desktop.md):
correct ownership first, remove restart/re-pair enrollment, then deliver signed
Mac builds with Windows boundaries designed in. YA now implements the
authority/capability boundary; AAR owns desktop acceptance. This work does not
displace release delivery.

| Direction | Existing context / decision still needed |
| --- | --- |
| Multi-machine experience across the full web and desktop clients | The simple-client demo above now owns the first grouping experiment; broader adoption follows evidence from that work and [source runtimes](../../topics/client-source-runtime-topology.md). |
| Agent coordination across installed machines | Direction selected 2026-10-03: persistent, target-owned YA sessions over the public relay, with explicit directional peer grants. The [bounded first-slice plan](../tactical/144-relay-peer-session-coordination.md) proposes the same local/remote worker API for Claude and Codex, existing target projects, and durable reconnect. Runtime implementation and peer protocol review remain pending. Hosted identity issuance, SSH provisioning, and same-conversation migration are not prerequisites; this does not displace release delivery. |
| Authentication and delegated access | [Limited users](../../topics/limited-users.md) delivers local accounts and project grants. [Principals and grants](../../topics/principals-and-grants.md) coordinates the broader proposed invitation/account and issuer boundaries; it does not approve a universal grant protocol. [Session notes and discussion](../../topics/session-notes-and-discussion.md) and [participatory Live Share](../../topics/relay-origin-and-share-gating.sketches.md#participatory-live-share) propose human-only notes/chat, owner-reviewed suggestions, and later explicit session-input grants. These remain later directions, not a newly ranked implementation queue. |
| Related work across repositories | [Issues & PRs](../../topics/issue-session-associations.md) now has experimental, default-off automatic ticket/URL discovery from viewed sessions and a configurable recent-session window, durable evidence, search and correction controls. Conservative URL/known-prefix matching, durable Jira project learning, and session-grouped browsing are implemented and locally validated. SQLite migrations and compatibility gating are implemented. Multi-server issue grouping enters the simple-client demo above; workstream/branch inference and tracker synchronization remain deferred. |
| Parallel work within one repository | Follow the [workstreams proposal](../../topics/workstreams.md), which uses ordinary lane clones; do not revive the old automatic-worktree sketch as an approved design. |
| Scheduling | Follow [yacron](../../topics/yacron.md) and its [open gap](../../gaps/sketches/yacron-scheduler.md); the first management UI remains a design prerequisite. |
| Agent command runtime | Opt-in [`ya-agent self`](../../topics/agent-self.md) implements ownership and model/effort evidence reporting. Use operator-managed global instructions initially; defer automatic advertisement, private input, broader session access, and scheduling integration. |
| Node 22 and built-in SQLite | Follow the approved [runtime cutover plan](../tactical/123-node-22-builtin-sqlite-cutover.md): raise the server runtime floor now, retain older-server hosted frontend support with advisory runtime warnings, and gate new SQLite-backed features by their exact capabilities before considering any separate frontend cutoff. |
| Source workflow depth and traceability | Build on [Source Control](../../topics/source-control.md), [review handoff](../../topics/source-review-to-session.md), and [commit/session attribution](../../gaps/sketches/committed-change-session-attribution.md). Additional Git or terminal controls need a concrete user workflow. |
| Provider maturity and other deferred work | Consult the owning provider topics and [deferred backlog](../../topics/deferred-roadmap.md); its local ordering does not override this product priority. |
| CI browser reliability and cost | The [CI isolation campaign](../tactical/135-e2e-suite-cost-ratchet.md) owns worker profiles, mutable services and joined cleanup. CI exercises two workers per existing shard. The fixed-source pair passed both schedules, with the worker pair's slower job 47.8% shorter and combined jobs 41.2% shorter; each needed one retry. Subsequent worker revisions completed first-attempt E2E repeats. September 30 fixture-home and reload-environment isolation resolved seven reproduced local failures; the full four-worker suite then passed 352 cases without retries. Source CI 36712930735 and follow-up 36715163980 each passed all 353 browser cases without retries, the full unit suite and every native platform leg. October 1 source CI 36799408077 is red on new dependency advisories and Windows computer-control cleanup; its passing browser shards include one retry in the All Sessions reservation assertion. Server Runtime And SQLite 36799408196 also failed Windows Bun package readiness. Local repairs cover audit resolutions, asynchronous cleanup with native regression coverage, port-file publication, measured macOS identity-probe headroom, and the reservation oracle. Final local browser verification passed 360 cases without retries plus 20 reservation repetitions. Repair commit `17a085b59` passed all 24 jobs in [CI 36816545726](https://github.com/kzahel/yepanywhere/actions/runs/36816545726), including 361 browser cases without retries and every native platform leg; [runtime/SQLite 36816545797](https://github.com/kzahel/yepanywhere/actions/runs/36816545797) passed all 12 platform/runtime legs on the first run. The documentation follow-up [CI 36817606854](https://github.com/kzahel/yepanywhere/actions/runs/36817606854) also passed, but exposed a right-pane reload retry: late app metadata made historical output look fresh. A deterministic hook regression reproduced that defect; discovery now remembers initial tool URLs before their mappings resolve. Thirty local browser repetitions then passed without retries, retaining concurrent typing and reload assertions. Source CI 36820386055 exposed a separate Intel macOS assembled-inventory timeout: its one-second status budget was shorter than the three-second native identity-probe bound. That scenario now gives inventory four seconds, derived from the observed CI limit; its lifecycle and process-identity checks remain intact. October 2 repairs vendor the original signed libsodium archive under its unchanged checksum, keep Apps domain rows compact, align desktop/phone quick-hide coverage with the shared-panel behavior, isolate saved defaults, join project deletion, select the current ASR plan after microphone acquisition, cancel transcript restoration frames on unmount, and stabilize resume/audio/copy fixtures. The first viewer popup and complete 200 MiB HTML I/O fixture have measured readiness budgets; content and typing assertions remain intact. Source `3049a2efb` passed all 24 jobs in [CI 36981624484](https://github.com/kzahel/yepanywhere/actions/runs/36981624484), including 370 browser cases without retries, and all 12 [runtime/SQLite legs](https://github.com/kzahel/yepanywhere/actions/runs/36981624522). Documentation follow-up `3a0132625` also passed [all 24 CI jobs](https://github.com/kzahel/yepanywhere/actions/runs/36982022730) and [all 12 runtime legs](https://github.com/kzahel/yepanywhere/actions/runs/36982022718), again without browser retries. The latest applicable [desktop](https://github.com/kzahel/yepanywhere/actions/runs/36981299593) and [iOS simulator/device](https://github.com/kzahel/yepanywhere/actions/runs/36981299572) workflows are green. [Remote deployment](https://github.com/kzahel/yepanywhere/actions/runs/36983665641) passed after a transient Cloudflare asset-fetch 502 cleared. [Android 36981624479](https://github.com/kzahel/yepanywhere/actions/runs/36981624479) passed build/standard instrumentation but still missed the unchanged 100 ms input frame gate at 149.4 ms; four guest cores and the current software renderer alone did not establish acceptance. The probe now establishes the native input connection, loaded fonts and stable viewport before upload/typing, and records frame attribution for further hosted misses. [Readiness source CI](https://github.com/kzahel/yepanywhere/actions/runs/36985655035) and [runtime/SQLite](https://github.com/kzahel/yepanywhere/actions/runs/36985655018) passed all 24/12 jobs. Its one Home-key retry raced a bare DOM scroll write against initial follow work; the fixture now uses a real upward wheel gesture and waits at the boundary, with 20 local repetitions passing. [Android readiness run](https://github.com/kzahel/yepanywhere/actions/runs/36985655022) passed direct/security, then missed only the first relay-upload key at 108.7 ms. Frame attribution exposed unnecessary memo-shortcut visibility and empty reload-stack layout reads; both now avoid ordinary typing work, with regressions that fail on previous code. The fresh bundled app passed physical direct/100 MiB relay at 42.8/33.3 ms with zero overflows; browser audio and streaming-typing checks also passed. Final hosted platform acceptance remains required. Large-catalog typing independently passed 20 repetitions (500 characters) with an 11.1 ms maximum; its 100 ms gate stays unchanged. Focused browser verification retains the typing and row-height limits. The comparable median/p90 window remains the campaign acceptance blocker. The separate initial search-highlight, [live search discovery](../../gaps/browser-suite-artifact-and-search-failures.md), [Windows extraction](../../gaps/windows-archive-extraction-test-timeout.md), and [Codex fake-process waiter](../../gaps/codex-provider-unit-startup-timeouts.md) findings remain open with bounded diagnostics. |
| macOS backend reload continuity | [Provider-host port](../tactical/128-macos-provider-host.md) has verification evidence for live Claude/Codex reload, approval, durable resume, concurrent sessions and terminal cleanup on Node source checkouts. Subsequent test-running sessions showed active-turn interruptions correlated with provider-owner exit, so macOS now defaults to ordinary in-Hono ownership and requires `YEP_PROVIDER_HOST_ENABLED=true` to opt in while the [interruption gap](../../gaps/macos-provider-host-turn-interruptions.md) is investigated. Linux remains enabled by default. Native CI still covers Linux, Apple Silicon/Intel Mac and Windows fallback. The separate [Claude project-alias history gap](../../gaps/claude-symlink-project-transcript-routing.md) remains open. This developer iteration work does not displace release delivery. |

## What changed from the old roadmap

The February 2026 list is superseded. Status/diff browsing, line-review
comments, and signed desktop installers are existing capabilities, not new
feature proposals. Source Control remains deliberately bounded; the old
stage/commit/PR checklist is not an approved expansion. The former blanket
"Not Planned" exclusions are retired rather than carried forward as current
product decisions.

The [T3 Code analysis](../competitive/t3code.md) informs this reprioritization.
Provider-native session continuity remains a central differentiator; release
availability and a coherent multi-machine mobile experience make it easier to
use. Further feature comparisons do not displace the publishing priority.
