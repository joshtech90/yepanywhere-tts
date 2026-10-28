# Remove SSH executors

Status: **rows 2 and 3 implemented and locally verified**, 2026-10-26. Implements house-cleaning rows 2 and 3
as separate verified commits, pushing each before proceeding.

## Released executor removal (row 2)

Delete the Claude SSH spawn and rsync/session-sync implementations, settings
routes/editor and launch selector. Preserve historical executor labels only
to identify retired records and refuse execution. Explicit stale-client SSH
requests, saved remote-session resume and direct non-HTTP provider launches
must fail rather than selecting a local checkout. Preserve local Claude,
Gateway/Ollama behavior, local goal reads, sandbox and agent-env safety.

The managed prototype shares SSH quoting/alias utilities, so retain those
until its own row 3 deletion. A pure local Claude transcript-folder helper
currently imported from session-sync must survive without importing rsync.
Do not touch Git SSH, Machine Control transport, saved YA host access or user
remote files/credentials. Close only defects exclusively about removed sync;
keep independent source-identity defects open.

## Managed runner removal (row 3)

Delete managed SSH session/target/workspace/diagnostic adapters, runner entry,
Codex auth projection and transcript mirror, dedicated build/probe commands
and tests. Remove remaining remote-only owner branches and utilities after
checking retained consumers. Preserve same-host runtime host/workers and
their actual stdio/socket consumers. No native remote-stop qualification or
remote workspace cleanup is required to delete this prototype.

## Verification and completion

For each cut, run required lint, formatting, typechecking and workspace tests,
plus focused launch/refusal and affected browser checks. Use isolated owned
profiles and Playwright Chromium. Verify sequential typing within 100 ms
where the creation form changes; capture retained desktop/phone UI through
the artifact facility. Update the cleanup ledger and owning contracts,
commit and push each completed row. This plan does not authorize row 10 or
graehl-led feature deletions.

## Results

### Released executor evidence

- Dedicated SSH spawn, rsync sync, settings routes/page, selector and tests
  are removed. SSH quoting remains only for the separately pending prototype.
- Explicit SSH start/create requests fail before launch. Historical executor
  records remain readable, but execution actions return 410 even when a
  caller asks for local; direct Claude and Supervisor paths also refuse.
- Four focused server suites pass: 347 tests, three existing skips, 2.49 s.
  Full-app session API coverage also passes (47 cases, 3.84 s).
- Owned New Session/account-discovery and Settings browser checks pass: four
  cases in 44.3 s. All 54 sequential keys are acknowledged; maximum 8.3 ms.
  Desktop/phone captures under `.artifacts/ui-testing/2026-10-26-remove-ssh/`
  were recorded through the artifact facility. Inspected settings controls
  fit at 1000×600 and 375×812; the retired category and launch selector have
  no remaining client entry points.
- Site check/build validates all 33 public pages; the historical announcement
  now identifies SSH execution as retired.
- Sync-only config-directory/rsync gaps close with their deleted implementation.
  Historical source identity remains a separate open gap.
- Final lint (zero warnings, one unrelated informational suggestion), format,
  typecheck and `pnpm test` pass. Server: 6,606 tests in 118.44 s; client:
  7,063 in 129.40 s; shared/relay/push-broker also pass. Existing intentional
  fault logging and Node SQLite notices remain in the root suite; affected
  focused checks are warning-free. No primary server restart or remote deletion.

### Managed prototype evidence

- Managed session/target/workspace/diagnostic adapters, injected entrypoint,
  dedicated stdio protocol, credential projection/transcript mirror and all
  build/probe commands are removed. No active source imports these facilities.
- Internal local/remote placement types and branches are removed; same-host
  host/socket workers and their deterministic fixture remain.
- The pinned `rust-v0.164.0` source was inspected before deleting only the
  prototype's external-token login/refresh integration. Ordinary Codex auth,
  router transport and experimental API/MCP capabilities remain. Local
  `codexHome` configuration remains: a retained regression caught its use by
  ordinary local config discovery, so it was preserved.
- Six focused host/settings/supervisor/Codex/rendez suites pass: 322 tests,
  two existing skips. No UI behavior changes in this cut, so the retained
  creation/settings browser evidence from row 2 remains applicable.
- Final lint (zero warnings; one unrelated informational suggestion), format,
  typecheck and `pnpm test` pass. Server: 6,578 tests in 117.63 s; client:
  7,063 in 132.33 s; shared/relay/push-broker also pass. Focused retained
  consumers: 322 pass, two skips, 23.27 s. Existing intentional root fault
  logging/SQLite notices remain; no credentials or remote workspaces touched.
- Source audit finds no active managed-runner/SSH placement or external-auth
  imports. Historical plan links point to the pre-removal source where needed.
  Local verification is macOS; Linux/Windows remain CI checks.

## Follow-up review: retired-session execution boundaries

The maintainer requested an independent Opus 5.5 high-effort review of the
four removal commits (`9e31f8ff0..0f259a96b`), using the existing local YA
work pool. The follow-up audit found two non-HTTP boundary gaps:

- Direct `Supervisor.forkSession` could fork a retired remote transcript,
  including when passed a frozen launch-settings snapshot. The child had no
  remote placement fact and could become a local writer. Refuse the source
  before provider lookup, sandbox work or transcript creation. Two real
  metadata-backed regression cases failed before the guard and pass after it.
- A retired heartbeat candidate could reach the resume refusal and throw
  before later local candidates ran. Exclude retired sessions before registry
  discovery/tail reads and deadline tracking; also refuse such candidates
  without throwing at the supervisor sweep boundary. The existing local
  unowned-heartbeat test now puts a retired candidate first and verifies that
  the local session still resumes. Local heartbeat automation remains retained.

Remove the obsolete provider-neutral SSH expansion sketch and its triage row:
retiring SSH closes that extension request rather than leaving it actionable.
The historical source-identity defect remains open.

Focused retained-consumer checks pass: 176 tests in 4.33 s, without runtime
warnings.

The independent report also identified an overbroad HTTP guard: the transcript
hover excerpt's read-only `refresh-preview` POST was blocked along with
execution. Permit that read path while retaining launch refusals. Its new
real-Hono regression failed with 410 before the correction and passes with
200 and no supervisor launch afterward. The three focused route/registry/fork
suites pass 46 tests in 1.80 s.

Repair the report's remaining actionable documentation findings: closed-gap
links and the historical landing anchor, deleted-code entries in open gaps,
current provider-host/public-share/federation statements, and incoming links
to the withdrawn SSH sketch. Remove the last dead Hosts preload hint. Record
the maintainer's explicit Gemini deferral; its registry and execution do not
change. The reviewer rechecked these corrections and reported **PASS: no
remaining actionable defect in the reviewed corrections**. Optional executor
plumbing simplification remains separate; readable metadata and its refusal
boundary must survive any later reduction.

Only the preload selection and comments changed on the client side; the
retained settings/creation browser evidence from plan 162 remains applicable.
The complete client suite was rerun after removing that hint (7,058 pass in
132.79 s). No provider-host or user service was restarted for this review.

Final verification: lint has zero warnings (one unrelated informational
suggestion), formatting and typecheck pass, and the full workspace suite
passes. Server: 6,582 tests in 121.50 s; client: 7,058 in 138.73 s; shared,
relay and push-broker also pass. Console scan and touched-CSS check pass.
Local evidence is macOS; no Linux/Windows execution is claimed. A relative
link audit also found a pre-existing triage row for the conversation
update-depth gap, already closed by `3e082cfa0`; remove that stale row without
changing its retained stream-coalescing implementation.
