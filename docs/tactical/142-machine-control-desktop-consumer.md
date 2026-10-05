# Consume the installed Machine Control desktop app

Status: complete, 2026-10-03. Installed Python packaging, authenticated shared
discovery, default-off session selection, accepted Mac/Windows model/media/
lifecycle use and Linux core control are implemented. YA's obsolete Windows
component lifecycle and UI are retired; remaining platform/provider cells are
explicitly outside the accepted slices below.

Owning topics: [Optional Computer Control](../../topics/optional-computer-control.md),
[Native sudo](../../topics/native-sudo.md), and
[New-Session Agent Tooling](../../topics/new-session-agent-tooling.md).

## Objective and originating direction

The maintainer requested a replacement for YA's separate Windows Machine
Control component now that MC has a desktop app. Installing MC should supply
the control CLI and its instructions, so any shell-capable agent can use it
without being told to inspect a source checkout. YA should discover and
advertise that installed interface, following the small native-sudo adapter's
pattern.

Keep the shared CLI in Python as an intentional architecture choice. Quick
command development must continue to work without a Rust toolchain or a desktop
rebuild. Distribution should package the same implementation with its runtime
and dependencies; it is not a preliminary step toward a Rust rewrite.

## Existing context and blockers

- [Tactical 131](131-optional-windows-computer-control.md) and its owning topic
  record the accepted Windows Node/local-Codex preview. YA still downloads,
  verifies, installs and updates a separate workstation component, launches its
  resident, supervises its descendants with a Windows Job Object, and owns
  session grants and a Windows-specific dynamic tool. This migration has not
  happened in the current checkout.
- [The native-sudo adapter](../../packages/server/src/sdk/providers/native-sudo.ts)
  already verifies a configured Mac app and helper signatures, adds the helper
  directory to agent PATH, and supplies an exact command path and instructions.
  It neither uses nor changes Computer Control settings.
- MC's [system map](../../../machine-control/SYSTEM-MAP.md),
  [distribution topic](../../../machine-control/topics/native-distribution.md),
  and [desktop product](../../../machine-control/desktop/README.md) own native
  packaging and lifecycle. Its current Python client invokes repository-local
  platform adapters and shared helpers. Bundling only the tiny launcher leaves
  an incomplete client.
- [Native exec privilege hardening](../../gaps/native-server-no-new-privs.md)
  remains separate. Native sudo deliberately crosses an OS privilege boundary;
  CLI advertisement is not a solution to same-user shell containment.
- [Windows validation](../../gaps/windows-validation-baseline.md) and the
  [historical archive extraction stall](../../gaps/windows-archive-extraction-test-timeout.md)
  remain existing evidence limits. Retiring an obsolete package path does not
  establish that its historical defects were repaired. Relevant local tasks
  contain prior CI diagnosis, not an existing desktop-consumer migration plan.

This work remains separate from the release-delivery priority in the
[roadmap](../roadmap/README.md). The immediate dependency is an accepted MC
package containing a source-independent CLI, not another YA installer.

## Intended ownership and experience

| Owner | Responsibility after migration |
| --- | --- |
| Machine Control | Desktop installation and updates, resident lifecycle, native approvals and arming, access enforcement, claims, CLI packaging, capability/result contracts, and agent instructions |
| YepAnywhere | Session eligibility and opt-in advertisement, verified discovery on the execution host, launch context, optional tool/transport adaptation, and result presentation |
| Agent | Read MC's instructions, discover capabilities, coordinate use, request access, and execute operations through the installed CLI |

```text
YA discovers and verifies the installed MC interface on the execution host
  -> eligible opted-in session gets a command path and short instructions
  -> agent runs MC's Python-backed CLI through its existing shell
  -> client reaches the installed target-native resident
  -> MC enforces access and executes the operation
  -> observations, refusals and artifacts return to the agent
```

YA discovers one supported entry point, not a directory of independently
callable Python scripts. MC may package Python modules, adapters and helpers as
internal resources. On macOS executable resources belong in the signed app
bundle; App Support holds writable configuration/state. Windows and Linux use
their platform installation and state locations. YA must not copy executable
code out of the app into an independently maintained helper installation.

PATH delivery is convenient, but instructions also carry the exact safely
quoted executable path because login shells can replace PATH. Invocation must
work from an unrelated directory. The commands below are implemented in the packaged client.

```sh
machine-control agent instructions
machine-control --target host desktop windows
machine-control --target host browser tabs
machine-control --target host browser snapshot --tab TAB_ID
```

## Boundaries

- First prove local `host` desktop/browser use, starting on macOS with the
  existing sudo discovery precedent. Prove Windows before retiring its old YA
  component. Linux is a separate acceptance cell, not inferred from Python
  portability. Preserve MC's target selection and remote/device contract;
  broader packaged adapter coverage can follow independently.
- MC's installed product must work without YA. Developers retain direct Python
  execution from the checkout; publishing changed commands to installed users
  still requires an MC release. YA does not ship a fork of the CLI.
- YA advertisement is configurable and default-off under
  [vanilla defaults](../../topics/vanilla-defaults.md). Discovery, session
  selection, target-use claims and MC access grants are distinct. A YA session
  id supplies attribution, not bearer authority. Use the vocabulary in
  [principals and grants](../../topics/principals-and-grants.md).
- Discover on the agent's execution host, not the operator's browser machine.
  Begin with local launches; remote executors and sandboxed sessions remain
  unavailable until their command/IPC route is proven. Do not widen a sandbox
  to make discovery succeed or fall back to the YA host's desktop.
- Native sudo remains independently selected and verified, with system sudo
  authentication and its local secure-field dialog. Desktop/browser access
  never implies administrator authority. Keep cancellation/failure terminal.
- YA must not duplicate MC's native grant UI, arming controls or updater. YA
  session selection controls advertisement or a tool adapter, not arbitrary
  same-user shell access. Removal of session advertisement cannot honestly
  revoke a grant MC has not bound to that session. Preserve existing tool
  revocation guarantees during migration or explicitly resolve that difference
  in MC before claiming parity.
- Retain a thin YA tool adapter only where it adds useful model/image delivery
  or session adaptation. It uses the same installed MC contract; neither MCP
  nor Codex dynamic tools are prerequisites for ordinary CLI use. Do not carry
  the Windows-only `hwnd` schema into the portable interface.
- The maintainer subsequently authorized end-to-end implementation and
  incremental commits. Releases and legacy retirement retain the acceptance
  gates below.

## Completion conditions

- A packaged MC CLI works with no checkout, system Python or developer
  toolchain, while the direct Python development path remains available.
- YA can verify and identify a compatible installation, including the CLI's
  dependencies, and advertise it only to eligible selected launches. Missing,
  tampered and incompatible installations produce bounded, useful failures.
- A real shell-capable agent reads installed instructions, performs semantic
  desktop and browser operations, and consumes a capture. Independent fixture
  state establishes effects; an accepted request alone is insufficient.
- Claims and native access approval/revocation behave honestly. Unselected
  sessions gain no YA context/environment changes or implicit approval.
- Native sudo shares installation discovery without broadening its existing
  selection, publisher checks or authentication boundary.
- Accepted Windows desktop-app use replaces the old component path with a
  deliberate compatibility/removal plan and no orphaned YA-owned processes.
  YA shutdown does not kill the independently installed MC app.
- Topics and both repositories' ownership documents distinguish accepted
  platforms/providers from open acceptance cells. Migration is complete only
  when obsolete lifecycle code and its product controls are retired safely.

## Ordered work

### 1 — package the Python control client in Machine Control

In MC, inventory the client dependency closure: common modules, local platform
adapters, claim helpers, subprocess executables and resource locators. Package
it with Python; eliminate checkout-relative assumptions and accidental system
Python dependencies in subprocesses. Ship one stable terminal entry point that
preserves stdout JSON, stderr diagnostics, exit status and artifact retrieval.

Resolve naming before shipping: the Windows/Linux desktop GUI binaries already
use `machine-control`. A separate launcher or a command dispatch mode must not
open/focus the settings UI for a normal CLI operation. Avoid a Rust command
port. Define how the packaged client discovers or asks MC to activate its
resident; YA must not regain resident supervision through this mechanism.

Prove a clean installation from an unrelated working directory, with the
source tree and developer Python unavailable, before adding the YA consumer.

### 2 — publish a discoverable CLI identity and agent instructions

MC owns machine-readable product/client version, supported protocol and feature
identity plus `agent instructions`. Settle exact discovery fields and commands
in MC's contracts; YA checks compatibility rather than guessing it from paths
or trusting a self-declared publisher. Verify installation authenticity before
executing its probes. Use platform-appropriate signed/authenticated packaging.

Keep the initial launch fragment small: executable location, purpose and the
instruction command. Full instructions cover doctor, capabilities, exact
claims and release, access requests, stale references, delivery/effect
uncertainty, captures/artifacts and scope-specific browser/devtools access.
Instructions do not perform an operation or obtain approval by being read.

### 3 — share verified MC discovery with native sudo

In YA, extract installation discovery and authenticity checks from the sudo
precedent into a small common consumer boundary. Keep feature availability
separate: an installed sudo helper does not prove a compatible control CLI,
and a working control CLI does not enable sudo. Preserve explicit configuration
precedence, trusted publisher sources and current configured-failure behavior.

Cover disabled defaults, exact paths with spaces, incomplete/tampered bundles,
incompatible versions, independent feature opt-ins and signed app replacement.
Revalidate at appropriate launch/use boundaries; do not retain a stale locator
or cache trust across an app replacement indefinitely.

### 4 — advertise installed control to eligible agent sessions

Reuse launch environment/context composition so existing instructions,
own-session tooling and feature selections survive. Supply the verified CLI
directory and exact command path, then let the agent invoke it through its
existing shell. Start with the already proven local unrestricted launch shapes;
verify other providers/runtimes separately instead of inheriting a Windows/
Node/Codex-only restriction or promising universal support.

Test real model use and capture consumption. If a provider cannot consume a
CLI artifact directly, implement the smallest adapter into YA's existing media
pipeline, preserving MC's bounded artifact validation and native result
meaning. Do not introduce a general persistent evaluator or register MCP in
every session to solve advertisement.

### 5 — prove the desktop route and migrate Windows consumers

Exercise local Windows desktop-app control with an exact signed package,
without a checkout and without the YA-managed resident. Retain independent
controller access for diagnosis. Prove ordinary enumeration, a semantic action,
browser operation, native approval refusal/revocation, stale-generation
rejection and screenshot delivery to the model and live/reloaded YA views.

Inventory what the old session-scoped tool guaranteed and how the new route
enforces or honestly changes each guarantee. Decide whether a thin tool adapter
is required before removing it. Existing grants must not be silently widened,
copied to MC, or revived on restart. An MC update/uninstall or resident restart
must yield explicit compatibility/unavailability results without replaying
uncertain mutations or reinstalling a legacy resident as fallback.

Only after acceptance, remove YA's component download/update/install controls,
resident launcher, Job Object supervision and idle shutdown for the migrated
route. Stop/uninstall only the legacy instance YA owns through its established
cleanup path; never terminate the desktop product or appliance service. Keep
failed cleanup locators for retry and provide deliberate handling of persisted
legacy settings and old clients. Follow
[server capabilities](../../topics/server-capabilities.md) and
[hosted compatibility](../../topics/remote-hosted-compatibility.md) before API
changes; do not repurpose capability IDs 70/71 with broader semantics.

### 6 — record acceptance and retire obsolete ownership

Run touched-area regression and repository-required source/UI checks as
implementation lands. Record actual OS, architecture, provider and runtime
coverage. Acceptance includes MC replacement with no active grant, refused
replacement while access is active according to MC policy, YA restart/crash,
session close, expiry, concurrent callers and unavailable app recovery.

Update YA's optional-control, native-sudo and launch-tooling topics; update MC's
system map, distribution and desktop topics in MC. Current legacy implementation
facts stay marked current until cutover. Keep captures, concrete targets,
credentials and execution traces in private test storage. For VM validation,
use MC doctor, exclusive claims and finally-style cleanup. Preserve existing
Windows gaps unless their specific closure evidence is obtained.

## Result and remaining acceptance

MC packages its existing Python client, local host adapters, claims and pinned
CPython for six desktop targets. Offline identity and owned instructions are
implemented. Portable dependency/inventory negatives and a source-independent
Mac ARM64 smoke pass. A locally assembled Developer ID signed Mac app passes
YA's real publisher, full payload and compatibility verifier. This is signed
assembly evidence, not notarization or published-release acceptance.

YA's common installation consumer verifies native signatures/catalogs or the
Linux signed receipt before executing any client probe. Opt-in local Codex and
Claude launch composition adds the exact command and PATH while preserving
existing context and own-session grants. Native sudo shares Mac app verification
and optional location configuration, while retaining independent feature
selection and native executable checks. The installed route refuses a launch
that also selects a legacy Computer Control grant.

Touched-area launch tests, full lint, format, typecheck and the complete unit
suite pass locally. The broader suite still emits unrelated failure-path
warnings recorded in [this gap](../../gaps/unit-failure-path-log-warnings.md).
The installed probe verifies a real signed bundle, relocated copy, launch-context
composition and wrong-publisher/modified-script/missing-interpreter refusal;
it does not start a model or establish screenshot consumption by one.

The signed Mac ARM64 assembly passes the installed CLI's bounded native-control
slice in a claimed appliance under workstation approval: denial, narrowed
scopes, an independent AppKit counter effect, capture/artifact PNG bytes,
self/protected refusal, prompt pause and Stop/revocation. The broader tray test
failed to discover a second update menu item; that updater slice remains open.

Browser acceptance passes 21 checks using Chrome for Testing, the signed
embedded native host/extension, the installed CLI and independent HTTP/Chrome
oracles. Captures and release/restart/reconnect pass. A real local YA Codex
provider turn reads the installed instructions/identity and consumes the native
browser fixture PNG through its actual image viewer. This tests launcher context
and model image consumption. The full-app/browser probe below additionally
proves live/reloaded YA media views; provider-driven control on the execution
host remains open.

The original Mac appliance policy/socket/resident are restored and doctor is
ready. The test browser/candidate are reaped, owned test state removed, guest
shutdown independently observed and all claims released. The canonical login
credential remains ready and owner-only. No credentials were rotated.

Remaining gates are full provider-driven control,
Windows and Linux installed acceptance,
replacement/restart/expiry/concurrency acceptance, and deliberate migration of
legacy persisted settings and cleanup. The old Windows product controls,
installer, updater, grant/tool contract and supervisor remain current until
those gates pass. Do not infer retirement from the new environment opt-in.

Linux ARM64 offline CLI execution passes in an isolated native container with
no checkout, network or system Python dependency. The relocated smoke covers
identity, instructions, local-target discovery and bundled claim capabilities.
Linux desktop approval, signatures and capture remain unaccepted. The declared
alternate controller has reachable Windows/Linux appliances with ready stored
credentials; the earlier Windows availability limit on the local controller
is not an infrastructure-wide blocker. Platform acceptance still requires a
signed candidate with the new CLI.

Windows x64 offline relocation also passes in a claimed Windows 11 appliance
using the bundled interpreter, with no checkout in the test payload. The
Windows desktop harness can now consume the installed command for control and
artifacts; native PowerShell parsing passes. The selection-refusal run was
blocked by guest script policy and is not counted as acceptance. Temporary
test files and owned upload carriers are removed, clean shutdown is confirmed,
the claim is released and the stored login credential remains ready. Signed
desktop/browser, actual YA control/media and legacy retirement remain open.

## Session-picker compatibility decision

**Decision:** Introduce optional `installed-machine-control`, using the next
free permanent capability ID 112, separately from legacy IDs 70/71. It covers
read-only `GET /api/machine-control` installation readiness and an optional
boolean `machineControl` on explicit session launch requests. The picker
defaults off and controls command advertisement, not MC access. Support varies
by host/configuration, so use an explicit optional bit rather than release
version inference. No approval, installation, update or resident lifecycle API
is added.

The optional-feature release corpus inspected on 2026-10-02 is v0.9.0
(2026-09-22), v0.9.1 (2026-09-24) and v0.9.2 (2026-09-26): all lack this
interface. Without the new capability, clients hide the picker and send neither
the readiness request nor the field. Existing Computer Control behavior, IDs
70/71 and cleanup remain unchanged until accepted cutover. Component and route
checks must prove that an older capability-bearing server receives no new
request/field. The maintainer resumed the authorized end-to-end implementation
on 2026-10-02 after the published MC release completed; this implements the
presented compatibility plan under the
[compatibility policy](../../topics/server-capabilities.md#minimum-compatibility-horizons).
Explicit false overrides the host-wide environment opt-in. Selection resets
when eligibility or the connected source changes. Installed and legacy control
cannot both be selected. The initial selector covers immediate explicit
launches; queue submission is unavailable while installed MC is selected,
with a tooltip explaining how to queue or start now.

The internal MC selection is now carried through all four provider/compatibility
SDK launch dispatches. Focused tests cover true, false and absent selection
with and without a first message; explicit false no longer disappears before
the provider wrapper. The real model probe now uses the actual supervisor and
verifies exact PNG bytes through live Process media and the reloaded native
Codex transcript's reader/normalizer/materializer. Preservation remains off;
the subsequent full-app probe proves browser views as described below, while
provider-driven browser control remains open.
The real probe passes with an isolated owner-only Codex profile that retains
the operator's auth/configuration and removes all test provider state in
cleanup. Its transcript scan has no dependency on unrelated personal history.
The supervisor wiring is committed separately; the public compatibility review
is still pending.

## Full-app live and reloaded media result

The repeatable real-model probe now uses the production app, session-detail and
media routes. It connects the real browser client before the model turn and
checks both desktop/phone image viewers against the native fixture PNG. Live
media fetches return the exact bytes with preservation off. The owned provider
stops, the app and media store are disposed, and a fresh backend reconstructs
media from the actual Codex transcript before the client reopens the session.
Reloaded HTTP and browser media bytes also match exactly; this cannot pass by
reusing the live media cache. Browser exceptions fail the probe.

The accepted run disconnects the viewer gracefully before backend replacement,
reaps the provider/browser and closes owned readers, services, sockets and
listeners. Temporary profile/auth/configuration, fixture and YA data are removed.
The nonpersonal desktop/phone captures are retained in ignored artifact storage
and presented for review. Original source media remains available until cleanup,
so this does not claim durable preservation when that source has disappeared.
The command and strict script type check are owned by
[the current topic](../../topics/optional-computer-control.md#installed-launch-and-media-boundary-acceptance).

This closes the live/reloaded media-view gate for the installed command's
real-provider fixture-consumption route. Provider-driven browser
operations, exact signed Windows/Linux installed control, grant and lifecycle
acceptance, public session-picker approval and legacy retirement remain open.

## Target-local native provider result

The Mac native provider probe now passes without either source checkout in the
appliance. A complete Codex runtime and bundled YA probe launch an opted-in
production Codex provider against the locally assembled signed MC app. Actual
tool calls read owned instructions/identity, enumerate and snapshot the AppKit
fixture, press its semantic Increment reference once, capture only its window,
fetch the unchanged artifact path and invoke the built-in agent image tool.
Independent fixture state increases by exactly one; the reported CLI protocol
and visible capture count agree with the actual results.

Early failed attempts remain failed: incomplete Codex staging omitted its
command host, one bounded run ended before the final response, and ambiguous
prompts permitted the resident protocol or an OS viewer instead of the
required client protocol and agent image tool. The final probe checks the
distinct requirements explicitly and deduplicates streamed tool events before
counting mutations. MC's owned instructions now explain supplied claims,
semantic press syntax and unchanged artifact paths.

The dedicated appliance's standing policy is verified; it does not replace the
earlier workstation approval evidence. Matching capture bytes are removed from
the native cache, owned fixture/resident processes and staged auth/profile are
cleaned, claims are released and initial power-off is restored. The newly
generated native PNG also passes the separate full-app live/reloaded HTTP and
desktop/phone media-view probe, with all four captures reviewed. This closes
the Mac local Codex native desktop/capture cell. Browser model control,
signed Windows/Linux cells, lifecycle/revocation parity, public picker approval
and legacy retirement remain open.

## Target-local browser provider result

The browser model probe passes against the same source-independent signed Mac
assembly. MC's headed extension harness adds an optional bounded YA callback
and a counter owned by its HTTP server. Chrome for Testing 145 passes all 23
checks: 21 installed-client indicator/worker checks and the model/effect checks.
Actual CLI calls read instructions/identity, enumerate/snapshot the fixture tab,
click its semantic button once, capture that tab, retrieve its unchanged path
and invoke the built-in image tool. Independent HTTP count and reported image
count agree. This is standing appliance authority, not workstation approval.

An initial stale harness archive refused the new arguments before browser/model
startup; the corrected handoff verifies exact harness bytes before execution.
The passing run restores the original native-host socket and removes the owned
browser/profile, native artifact and temporary app/runtime/authentication,
releases claims and confirms initial power-off. Eight extension unit checks and
Python compilation pass. The generated tab PNG separately passes full-app
live/reloaded HTTP and desktop/phone views; all four captures are reviewed.
The strict probe type check, full lint/format/typecheck and complete YA unit
suite pass. Signed Windows/Linux cells, lifecycle/revocation parity, public
picker approval and legacy retirement remain open.

Validation: full lint, format, typecheck and the strict probe type check pass;
the final full suite passes (server 6,312 plus 67 skips, client 6,634, shared 940,
push broker 45 and relay 130). A restrictive-umask run failed two existing
mode assertions; a later loaded run timed out one Supervisor fake-timer case
and caused a following timer error. The affected three files pass 161 tests
in isolation, and the final normal-umask suite passes after appliance cleanup.
The existing failure-path warning debt remains separately documented.

## Release-candidate discovery alignment

The six-platform MC release work moves Linux's bundled CLI to
`/usr/share/machine-control/mc-cli` and changes Windows 0.5.3 CLI catalogs to
authenticate the full-byte inventory. YA follows both contracts. The signed
Windows GUI version selects inventory versus earlier full-directory catalog
verification, with no fallback after a newer-format failure. Complete payload
hashes still precede every installed-code probe. Focused checks cover Linux
default/explicit roots and Windows payload refusal after catalog verification.
Exact signed Windows/Linux installed and native acceptance remain open.

Validation: 18 focused MC/sudo checks pass without warnings. Full lint,
format/typecheck and unit checks pass (server 6,314 plus 67 skips, client 6,634,
shared 940, push broker 45 and relay 130). The already recorded intentional
failure-path log warnings remain in their separate gap.

## Installed Mac claim and resident recovery result

MC's new bounded lifecycle helper passes with the source-independent signed
Mac assembly. A separate harness-owned native resident/socket and claim store
prove exclusive acquisition, concurrent claimed observations, real one-minute
lease expiry and superseded-claim refusal. With that owned resident stopped,
doctor reports unavailable and target operations refuse while offline CLI
identity still works. The CLI creates no replacement. An explicit harness
restart changes the native generation and preserves the still-live claim.

The original appliance resident stays ready. The helper reaps its resident and
removes isolated state; the controller restores initial power-off and releases
its claim. This is MC claim/resident recovery acceptance, not YA session
close/crash, native grant expiry, signed app replacement or Windows/Linux
lifecycle parity. MC's [tactical record](../../../machine-control/docs/tactical/062-installed-agent-cli.md#installed-mac-claim-and-resident-lifecycle-result)
owns the repeatable helper and evidence scope. The public picker approval and
legacy retirement gates remain unchanged.

## Full YA app close, restart and crash result

The new strict-checked lifecycle probe passes in the dedicated Mac appliance
without either checkout. A bundled production app, its normal dependency
resources, complete Codex runtime and isolated auth/profile use the signed MC
assembly. Two actual model turns query only installed instructions/identity.
The production Supervisor verifies session abort by native PID and unregisters
it. The full app disposes its readers/services and a fresh instance has no live
provider for that session. MC's independently observed PID, native generation
and exact held claim remain unchanged across both operations.

A separate owned full-app process completes its real workflow before abrupt
`SIGKILL`. MC stays healthy with the same PID/generation and claim. Codex owns
a process group separate from YA; cleanup validates its executable/staging
root, kills that owned group and observes its exit. Cleanup retains failures,
closes logs and disposes owned services. The controller removes temporary
app/runtime/auth/data, confirms the original resident is still ready, restores
initial power-off and releases host/controller claims.

Two earlier staging attempts failed before app startup: an ESM shim conflicted
with the app's `__filename` binding, then a required SDK resource locator was
missing. They remain failed attempts with completed cleanup. The final bundle
passes syntax checking and includes the real dependency closure. This closes
Mac YA session-close, app restart and crash isolation. It does not establish
native grant expiry, signed replacement, Windows/Linux parity, public picker
approval or legacy retirement.

Validation: strict manual-probe types, bundle syntax, full lint/format/typecheck
and all unit checks pass (server 6,314 plus 67 skips, client 6,634, shared 940,
push broker 45 and relay 130). The passing parent/child runtime logs have no
warning/error events; broader intentional failure-path test warnings remain
recorded in the existing gap. No new product UI or public contract is added.

## Installed Mac native grant expiry result

MC's dedicated [native grant-expiry harness](../../../machine-control/tests/macos/cli-grant-expiry.py)
passes through the signed installed client under workstation approval. The
standing appliance observer visibly approves an observe-only 60-second request.
An AppKit fixture observation succeeds, then actual deadline expiry reports
`expired` and a further observation refuses with `approval_required`. The
candidate PID stays unchanged. This exercises native access authority rather
than the separately accepted target-use claim lease.

Cleanup disarms access, restores the trusted policy file, reaps owned processes,
removes staging, confirms original resident readiness, restores initial power-off
and releases claims. The first harness attempt failed on approval-label and
optional action-data assumptions; it remains failed, with cleanup completed.
The corrected fresh run passes, as do syntax checks and MC's 61 release tests.
Signed app replacement, Windows/Linux acceptance, public session-picker approval
and deliberate legacy retirement remain open. YA product code, UI and public
contracts are unchanged by this acceptance record.

## Exact notarized Mac candidate discovery result

Both Mac signing jobs passed in workflow 37054647423 despite Windows/Linux
failures. The ARM64 0.5.3 candidate has signed source identity `698550b`. MC's
package verifier accepts its exact updater signature/version, source, complete
CLI closure, native publisher signatures, Gatekeeper and stapling, and refuses
modified archive bytes. Physically relocated offline execution and the
unavailable-resident negative also pass.

YA's installed probe accepts the same candidate's publisher, identity,
instructions, launch context and relocated copy, and refuses wrong publisher,
modified script and missing interpreter. The first full probe stopped on macOS
App Management refusing a write inside a copied notarized app. Its temporary
state was removed; this failed attempt does not count as negative acceptance.
The corrected probe constructs invalid fixture bytes before copying Info.plist
and passes the unchanged production verifier. No OS permission is changed.

The installed probe now belongs to the strict manual-probe type configuration.
Strict types, bundle syntax, full lint/format/typecheck and all unit tests pass
(server 6,314 plus 67 skips, client 6,634, shared 940, push broker 45, relay 130).
Existing deliberate failure-path warnings remain in their recorded gap. This
qualifies discovery for the exact notarized candidate; real control and lifecycle
evidence above used the earlier locally signed assembly. Published release,
signed replacement and the other platform/cutover gates remain distinct.

## Public launch selection implementation

The authenticated read-only installation route is mounted before capability
112 is advertised on macOS, Windows and Linux. The four explicit HTTP launch
shapes preserve true, false and absent selection through the existing
supervisor wiring; malformed and conflicting choices fail before launch.
Readiness and launch use the same verified installed-product boundary.

The default-off advanced option is implemented for eligible local providers.
Existing legacy-capability servers receive neither the new request nor field.
Off is explicit on capable servers, preserving user choice even when the host
uses the environment opt-in. Project queue launch does not silently discard a
selected installed capability; the queue action explains that the user can
turn it off or start immediately.

Validation on 2026-10-02: focused route/launch/capability tests and full checks
pass (server 6,326 plus 67 skipped, client 6,638, shared 940, relay 130 and push
45). Lint, formatting, typechecks, console scan and CSS architecture pass;
console metrics are unchanged. The broader suite still emits the negative-path
diagnostics recorded in [the existing warning gap](../../gaps/unit-failure-path-log-warnings.md);
touched tests emit no warnings.

The focused browser case uses a synthetic available installation and 200-model
catalog to test the client boundary, not native MC acceptance. Readiness resolves
during sequential typing, every character persists and input acknowledgement
stays below 100 ms. Desktop (1000×600) and phone (375×812) captures were reviewed
separately: On is clear, the description remains grouped with the selector and
neither layout overflows. Captures are retained under
`.artifacts/ui-testing/2026-10-02-installed-mc-picker/` as
`installed-mc-desktop.png` and `installed-mc-phone.png`.

The published six-platform desktop 0.5.3 packages now unblock signed Windows
and Linux acceptance. Native control on those installed candidates and legacy
retirement remain open; the Mac replacement result below closes that cell.

## Published Mac replacement result

MC's [installed update probe](../../../machine-control/docs/tactical/062-installed-agent-cli.md#published-mac-installed-cli-replacement)
now passes with an owned signed 0.5.2 sender fixture and untouched public Mac
ARM64 0.5.3 receiver from `d5aa271ca93d890325a12b0906432b762a4aaec4`.
YA's actual consumer authenticates the product, composes launch context and
rejects publisher/script/interpreter negatives both before and after native
replacement. The new installed CLI reports 0.5.3 under the existing host claim.
Access is off after automatic relaunch; permission and generation/stale-reference
checks pass. Original trusted policy, resident readiness, power-off and released
claims are verified. This closes the Mac signed replacement gate without
claiming a published 0.5.2 sender or Windows/Linux parity.

## Public Windows x64 installed-client gate

**Current (2026-10-03):** Published desktop 0.5.3, source `d5aa271`, passes
YA's actual installation consumer in an ordinary interactive Windows 11 x64
session. Product and full dependency authentication, compatible identity,
instructions, launch-context composition, relocated copy and wrong-publisher,
changed-script and missing-interpreter negatives pass. The official installer
was authenticated with the pinned updater key and signed version before its
valid timestamped native signature supplied the expected publisher.

MC's existing installed-command Windows harness proves access-off refusal,
visible native approval, one independently confirmed Cua counter increment,
exact-window capture/artifact SHA-256, capture-superseded reference refusal and
native Stop. There is no source checkout in the staged payload. The actor uses
per-process PowerShell policy without changing guest policy or authorization.
This is production consumer plus CLI evidence, not provider-driven model or
live/reloaded YA image-view evidence.

The native installer restored an earlier custom test location on the first
attempt. The accepted isolated run pins the normal product path and backs up
and restores the existing uninstall registry. Owned app, runtime and staging
are removed, initial power-off confirmed, and all local/controller claims
released. Windows model/browser/media and lifecycle acceptance, Linux GUI
acceptance and legacy migration remain open; no old component was retired.

## Authenticate an active Windows resident

**Current (2026-10-03):** The real Windows provider attempt exposed an installed
consumer defect: initial authentication passed with the app absent, but
`Test-FileCatalog` could not read the resident executable after native control.
YA now verifies a bounded temporary copy of the complete runtime with the
unchanged catalog check. Original native publisher checks remain; the copied
catalog also requires the same valid timestamped publisher signature. Links,
excess depth, entries and bytes are refused, and copies are removed on every
success/failure path. Runtime metadata comes from the catalog-verified copy.

The real ordinary-user Windows attempt passes authentication and reaches the
model's installed CLI control/capture calls while the resident is live. Its
image-path assertion needed Windows separator/JSON normalization; complete
model acceptance remains pending rather than inferred from those calls.
Focused authenticity tests and full lint, format, typecheck and unit suites
pass. Existing broad-suite failure-path warnings remain the documented gap.

## Real Windows native model and Linux core acceptance

**Current (2026-10-03):** An ordinary interactive Windows 11 x64 YA Codex
0.159.0 provider turn passes against exact public desktop 0.5.3. Its staged
vendor runtime, isolated authenticated profile and bundled YA provider require
no MC/YA checkout in the guest payload. The model reads installed identity and
instructions, uses the caller-owned host claim and installed command for native
window discovery/snapshot, one semantic invocation, window capture and artifact
retrieval, then consumes the new PNG with the built-in image viewer. Independent
fixture process/count and reported visible count agree exactly. Windows currently
uses the owned native JSON CLI route for its handle-bound snapshot; this does not
claim that `desktop snapshot --target APP` resolves Windows handles.

YA reauthenticates the live product before provider launch. Provider close leaves
MC usable; native Stop then revokes access. Original custom-install registry is
restored, owned product/runtime/fixture/profile/staging removed, power-off confirmed,
and both model/controller claims released. Full YA media views, Windows browser
and additional close/crash/lifecycle gates remain separate.

Public Linux 0.5.3 Debian x64 also passes actual YA signed receipt/full dependency
verification, identity/instructions/context, relocation and changed-script/missing-
interpreter negatives. Forty-six bounded checks use the installed CLI for native
approval/refusal/expiry, explicit portal consent, capture/artifact hash, independent
GTK semantic/pointer/Unicode effects, restart revocation/sharing closure, tray and
operator loss. The first broad run stopped at the Stop-shortcut checkbox; the
accepted slice excludes startup/shortcut settings and does not count that broader
run as passing. Initial package absence and original power-off are restored, owned
units/staging removed, and local/controller claims released. Linux browser/model
and further lifecycle cells remain explicit.

## Windows browser and custom-location result

**Current (2026-10-03):** Exact public Windows x64 desktop 0.5.3 passes
installed browser setup, native messaging, visible grant/deny, independent
semantic click/text effects, browser capture/hash, browser-only evaluation
refusal, native Stop, stale references, DevTools/CDP, operator restart and
extension reconnection. Chrome for Testing 145.0.7632.117 has its own profile
and identity; the primary browser is not used.

An actual source-independent YA Codex 0.159.0 provider authenticates the live
product and uses the installed CLI for one browser fixture click, capture,
artifact retrieval and built-in image consumption. The independent HTTP counter
increments exactly once and matches the reported image. YA supplies the
authenticated custom product directory to the selected agent environment;
there is no inherited native-helper installation override in the actor.

Cleanup restores the original native-host registry/manifest and uninstall
registry, removes owned browser/app/runtime/profile/staging, restores initial
power-off and verifies local/controller claim release. Full Windows YA media
views and additional lifecycle cells remain separate gates. The model child
emits Node's existing shell-spawn deprecation (DEP0190); its successful control
evidence does not imply warning-free Windows provider transport.

Validation: the focused launch checks and full lint, format, typecheck and unit
suites pass (server 6,326 plus 67 skipped, client 6,638, shared 940, relay 130,
push 45). Existing broad-suite failure-path warnings retain their separate gap.

## Windows full-app media and cleanup result

**Current (2026-10-03):** exact public Windows x64 desktop 0.5.3 passes an
actual full YA app/Supervisor/Codex 0.159.0 turn with the installed CLI selected.
The model reads offline identity/instructions and observes a previously accepted
native Windows browser fixture capture with its native image viewer. Live
Process media serves the exact PNG bytes with `private, no-store`. After verified
provider abort and full app/media-store replacement, production session detail
reconstructs the same bytes from the actual transcript with preservation off.

Built production client assets served by that app pass live and reloaded image
views at 1000×600 and 375×812. Chrome for Testing has a distinct executable and
owned profile. Its first-run setup is completed through the ordinary Skip all
control; no overlay or click assertion is bypassed. All four captures were
inspected separately: the fixture button/counter is retained, the desktop
controls fit, and the phone toolbar wraps without horizontal overflow.
Ignored captures are under `.artifacts/ui-testing/2026-10-03-windows-mc-media`.
The installed selector's corresponding desktop/phone captures are under
`.artifacts/ui-testing/2026-10-03-installed-mc-retirement`; its selected state,
revocation caption and mobile grouping are visible. Sequential typing passes
the unchanged 100 ms gate while readiness changes.

The initial media run passed rendering but failed owned profile removal on an
open Codex discovery database. Model discovery now joins app-server termination
before returning and releasing its installation lease. Native `.exe` spawns
avoid the command shell; expired streaming delays are clamped without changing
publication ordering. Focused ownership/deadline checks and the full unit suite
pass. The corrected Windows media run cleans its owned authentication/profile,
app/browser/runtime/staging and claims without DEP0190 or negative-timeout
warnings. Original installation registry and initial power-off are restored.
The failed broader run is not counted as full lifecycle acceptance; that gate
uses its separate installed probe below.

## Windows lifecycle and consumer cutover result

**Current (2026-10-03):** the existing full-app lifecycle probe now passes
against exact public Windows x64 desktop 0.5.3. Actual local YA Codex turns
read the verified installed instructions and identity. Supervisor abort verifies
provider exit and removes the session process. Full app shutdown/disposal and a
fresh app leave MC's independently observed PID/generation and host claim
unchanged. A separately owned actual YA process is then killed abruptly after
its model turn; MC remains reachable with the same identity and claim. Owned
Codex processes are reclaimed by exact staged executable/process identity; no
MC process enters that cleanup. The caller releases the local claim, removes
its product/profile/staging, restores the original uninstall registry and initial
power-off, and verifies controller claim release.

Failed attempts exposed test assumptions rather than accepted lifecycle cells:
Windows startup can briefly produce no health object; the caller now waits for
a real accepted status. Command verification handles Windows case, redundant
separators and nested/quoted argument representations while requiring the exact
verified installed executable. Offline query assertions accept quoted arguments.
The ordinary-user actor never widens machine PowerShell policy. The first failed
ACL setup's exact empty directory was identified by creation time, no-link state
and emptiness, then removed through a fresh claimed operation. No anonymous
fixture directory or test auth/profile remains in the accepted run.

**Decision:** resolve the old lease difference by making this a CLI advertisement
feature. Native MC Stop, grant expiry and MC restart own revocation. YA session
close does not revoke a native grant or contain same-user shell use. The launch
fragment and final desktop/phone picker explicitly say so; no old deferred tool
lease parity is claimed. This closes the plan's authority decision rather than
retaining a second installer/grant UI to imply containment.

**Current:** old installer/updater, IPC service, Job Object supervisor, settings
pane, session selector and deferred namespace are removed, together with their
obsolete manual acceptance scripts. IDs 70/71 remain reserved and are no longer
advertised. Authenticated old endpoints give 410 guidance; true old selections
refuse before launch. Generic native tool/image history handling is retained.

A bounded startup shim durably disables old enablement/auto-update before cleanup.
It authenticates the stored manager and exact YA-instance locator, refuses other
instances/desktop roots/links/changed active identity, and uses scoped signed
Stop/Uninstall without guessed PID cleanup. Failure retains disabled metadata
for later retry; unsupported hosts do likewise. Absence does nothing and success
clears the old metadata. Cleanup never starts a resident, downloads a component,
selects the new feature or touches the independent desktop. The selected test
appliance has no accepted legacy workstation package to exercise a signed
positive uninstall; unit checks cover exact-instance success/retry/refusal and
the production signed-manager boundary is retained. No positive native uninstall
is inferred from mocks. A fresh claimed Windows run additionally exercises
the real production cleanup against an unsigned owned manager: its marker is
never written, cleanup reports pending, and a fresh real settings service
reloads disabled enablement/auto-update with the exact retry locator retained.
That bounded native negative passes without touching any installed MC instance;
its owned data/staging is removed, initial power-off restored and claim release
verified.

## Final validation and result

Full lint, format and typecheck pass; the manual probes typecheck. The complete
unit suite passes: server 6,302 plus 63 skipped, client 6,636, shared 940, relay
130 and push 45. Focused retirement/launch/route/provider/Supervisor checks pass
194 cases. The selector browser test passes with sequential typing and reviewed
1000×600 / 375×812 captures. CSS architecture/modules checks pass. Console scan
has no drift (110 warnings, 60 warn calls, 92 error calls). The broad-suite
intentional failure-path warnings remain in their existing
[gap](../../gaps/unit-failure-path-log-warnings.md); capability audit has zero
errors and two pre-existing overdue review warnings covered by
[their gap](../../gaps/overdue-transitional-capability-reviews.md). The accepted
Windows media/lifecycle runs emit no DEP0190 or negative-timeout warning.

MC's public 0.5.3 release supplies authenticated bundled Python clients for all
six desktop targets; YA consumes the installed interface without a checkout or
CLI fork. Mac/Windows native/browser model, media and lifecycle gates and Linux
core control are accepted with their declared scope. Actual Claude model use,
Linux browser/model and further lifecycle cells, other GUI architectures, remote
executors and sandbox delivery remain separate. Windows high-level application
snapshot resolution and Linux startup/Stop-shortcut settings are not claimed.
The continuing contract lives in the owning topics; earlier paragraphs above
remain the execution record of now-closed migration gates.
