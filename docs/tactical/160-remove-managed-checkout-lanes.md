# Remove YA-managed checkout lanes

Status: **implemented and locally verified**, 2026-10-26. The maintainer authorized removing
[house-cleaning](../../topics/core-house-cleaning.md) rows **1, 2, 3, 11 and
12**, with verification, a commit and a push after each feature. This first
plan covers row 1 only. Conversation API/preview (row 10) remains outside this
implementation pass. graehl-led automation and same-host provider workers stay.

## Outcome and boundary

Remove workstream metadata services, managed clone creation/seeding, lane
routes/events, the developer toggle, lane page and new-session lane chooser.
Stop grouping independent checkouts through the workstream registry. Ordinary
project scanning, user-created Git worktrees, Source Control, queues and local
session ownership remain functional.

Do not delete existing checkout directories, branches, workstream registry
files or transcripts. Preserve historical session identity and actual working
directories. Requests from stale clients that explicitly target a removed lane
must fail before provider launch, rather than silently starting locally. The
new client must continue ordinary creation against existing supported servers;
no new capability, transport or migration framework is needed for deletion.

## Inventory

- Server: `WorkstreamService`, `/api/projects/:id/workstreams`, startup and
  app dependencies, scanner grouping/cache provenance, session start/admission,
  worker launch metadata, collection generation and activity access.
- Client: `WorkstreamsPage`, local/remote routes and preload, New Session
  chooser and API methods, Development setting and workstream activity events.
- Shared/storage: workstream types, exports and metadata mutation helpers;
  remove active behavior without rewriting user-owned historical data.
- Tests: delete dedicated lane creation/grouping/page suites. Preserve general
  scanner, metadata, settings, launch, queue and authorization coverage. Keep a
  meaningful launch-boundary regression for stale explicit lane requests.
- Documentation: replace the active workstreams proposal with its retirement
  contract, retire the obsolete implementation plan, and record row 1 status
  in the cleanup ledger/roadmap. Preserve independent worktree/file defects.

## Implementation and stopping conditions

### 1 — remove lane owners and their active consumers

Delete dedicated files, remove registry startup and event propagation, simplify
scanner identity to actual project paths, and remove lane-specific launch
selection. Preserve a narrow refusal for the removed request field at existing
session-creation boundaries. Do not weaken shared admission or sandbox policy.

### 2 — remove client entry points and obsolete configuration

Delete the lane page/chooser and developer control, dedicated API/types/styles
and tests. Old configuration remains inert; no filesystem cleanup is performed.
Keep normal creation/resume and all unrelated Development settings functional.

### 3 — verify, commit and push row 1

Run required lint, format, typecheck and workspace tests. Run focused session
creation/settings/scanner checks and affected browser flows, including real
sequential typing with concurrent updates where the changed input path applies.
Capture and inspect retained UI at desktop/phone sizes through the repository
artifact facility. Use owned disposable fixtures; never restart the primary
YA server or use its browser profile.

Record results and limitations here, update the owning retirement contract and
cleanup ledger, commit the completed removal with its model trailer, and push
`main`. Then proceed separately with released SSH (2), managed SSH (3), the
Hosts placeholder (11), and Gemini ACP (12). No further feature is added to
this pass by discovery.

## Verification record

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` pass.
  Lint reports zero warnings (one unrelated informational suggestion).
- Node 22.23.3 workspace tests: server 6,621, client 7,075, shared 968,
  relay 139 and push broker 45 pass, plus root Node checks. The root run
  emits existing intentional fault-test logger output and Node's SQLite
  experimental notices; affected focused tests emit no runtime warnings.
- Focused route/scanner/settings/metadata and nested-upload watcher run:
  298 pass, one platform case skipped, 6.11 seconds. Stale lane start/create
  requests are refused before either provider-launch method is called.
- Owned Playwright New Session defaults and Project Queue checks: two pass
  on Node 22 in 39.6 seconds, without retries. All 54 sequential keys under
  48-account discovery arrive within 100 ms; observed maximum 7.1 ms.
- Desktop 1000×600 and phone 375×812 captures were produced through
  `recordUiCapture` under `.artifacts/ui-testing/2026-10-26-remove-lanes-node22/`.
  The retained project selector, queue, composer and provider controls fit at
  both sizes; no lane chooser remains. The same layout was inspected on the
  initial capture run before repeating under Node 22.
- `pnpm css:check --record`, `pnpm css:touched` and `pnpm console:scan`
  completed. Dead lane CSS was removed and its global ceiling lowered.
  Further shared-style extraction would expand the affected surface.
- An initial Node 26 whole-server exploration hit one unrelated nested-upload
  watcher failure. The focused and full Node 22 runs pass; the observation is
  retained in the adjacent gap rather than changing unrelated watcher code.
- Local validation is macOS; Linux/Windows CI remains the platform check.
  No primary YA server was restarted and no user checkout was removed.
