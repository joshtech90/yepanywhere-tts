# Usable projects from approved templates

Status: implementation started, 2026-09-21. Native library loading/composition
and source settings are implemented; production creation remains unimplemented.
Contributing-model: 6-Astra.

## Implementation checkpoint — 2026-09-21

The user authorized implementation and expanded the default limited-user
selection to every template at agents HEAD `947fc67`: App canvas, Storybook,
and Web page. All three remain draft until their content review/admission.
Apply this scope to the two-template acceptance cases below as well.

- Complete: native inventory/manifest validation and ordered file composition,
  with 26 passing conformance cases. The actual current library composes to
  38, 55 and 51 files respectively, without Python or setup execution.
- Initial compiler verification: full workspace unit tests, formatting, typechecking and lint
  exited successfully on Linux; targeted Oxlint passed. The sole lint warning
  was removed by the behavior-preserving cleanup commit `c704a8d85` and targeted
  lint passed without warnings. Concurrent client work independently removed
  an initial renderer CSS size violation before the successful lint run.
  No macOS/Windows or actual provider/session verification is claimed.
- Complete: ordered GitHub source settings, private full-content retrieval,
  revision stamping, manual up-to-date checks, repository-alias relocation and
  combined-library validation. Later sources replace matching definitions;
  community templates can extend YA-default bases. Empty subdirectories mean
  repository root. Automatic update checks remain a sketch.
- Complete: user-facing authoring guide in `topics/project-template-authoring.md`
  (`799bcd2b3`), copied exactly into agents `project-templates/README.md`
  (`77a2cf9`), with pinned provenance and YA's MIT notice. Original agents
  material uses MIT-0 (`eb6b931`); imported content retains its own terms.
- Verification: all ten source-service tests pass, including limited-user
  denial, concurrent-request rejection, layered inheritance and dependency
  relocation. A real UI fetch at agents SHA
  `635f865044709f8262f3c6f9620ed75225989687` composes all three templates;
  repeating the update reports Already up to date. Lint, formatting,
  typechecking and the capability audit pass. The full workspace unit run
  passes outside the existing client credential-fetch race documented in
  `gaps/issue-settings-fetches-credentials-before-opt-in.md`; no claim of a
  fully green unit suite. The full browser suite finished with 290 passing,
  seven skipped and one unrelated effort-dialog failure, recorded in
  `gaps/long-context-effort-fork-browser-race.md`. All five template browser
  cases passed, including v0.8.0/v0.8.1 fallback checks.
- Final local-overlay verification: all 5,662 server tests pass (27 skipped),
  and the five template browser checks pass after covering punctuation in
  local aliases and clearing a hidden revision when switching to a local path.
  Lint, formatting, typechecking and capability audit pass. Final source-form
  captures at 1200×600 and 375×812 were inspected under
  `.artifacts/ui-testing/2026-09-21-template-sources-final-local/`.
- User-directed UI polish: Project templates has both line and glyph icons.
  Shortened category captions; all 25 visible English captions occupy one
  line at 1200×600 and 375×812 in both icon styles, without clipping. Captures
  under `.artifacts/ui-testing/2026-09-21-settings-captions/` were inspected.
- Complete: one GitHub-or-local-directory field includes the GitHub content
  path. Local overlays use their files directly, without copying or rewriting;
  owning Git HEAD is informational and every update revalidates working files.
- Pending: ready-content admission, fresh-target materialization, durable
  setup/preparation, permissions/sandboxing, App access/reservations, creation
  UI and project-local identity. Template retrieval remains opt-in/default-off.
- Approved: the supported-release capability/fallback plan below. Existing
  limited users retain project-only scope and receive no template-creation
  grant; defaults apply only to new users. No migration has run yet.
- Complete: Delete user requires confirmation, naming the account and
  explaining that grants/usage are removed but files remain. Cancel sends no
  deletion request. Seven focused component tests and desktop/phone browser
  checks pass; both rendered captures were inspected. Full lint, formatting,
  typechecking and unit tests pass; browser suite: 284 passed, 7 skipped,
  plus the two new confirmation checks. This does not implement
  the pending personal-directory defaults: recreation must use the same default
  path when those land, without claiming to restore deleted grants or usage.

The compatibility proposal keeps older servers on existing-directory creation
and legacy name/caption edits, hides new template/workspace/coda controls and
sends no new requests/fields when the corresponding new capability is absent.
Use separate template/workspace and identity capabilities; preserve existing
capability meanings. Optional corpus: v0.8.0/v0.8.1; existing identity-edit
fallbacks also require inspecting the 60-day core corpus before wire edits.

## Outcome and authorization

Deliver working App canvas, Storybook and Web page projects through YA for
both limited users and regular superusers. A user enables templates, selects an allowed
starter, enters a name and intent, and receives an immediately usable App pane
plus one automatic project preparation session. They can subsequently ask the
agent to build their app, run/test it, revisit it after restart, and add the
vendored server capability without access to the template source repository.

The implementation request now authorizes runtime implementation. All existing
UI prototypes are approved. Their local fixture interactions are not evidence
of production behavior. Do not reopen
settled UI choices; inspect live code before choosing implementation details.
The compatibility plan required by DEVELOPMENT.md is approved as recorded
above. This plan's numbered sections describe dependencies,
not additional user approval gates invented by this handoff.

The best next action on implementation is to reconcile the source/library
state, read the current contracts below, and implement the approved
capability/fallback plan while checking the source packaging boundary.

## Authorities and current evidence

Read these before implementing their corresponding slice:

- [Project templates](../../topics/project-templates.md), especially the
  current contract; the historical prompt-first design below it is superseded.
- [Limited users](../../topics/limited-users.md), including the approved
  workspace extension; [principals and grants](../../topics/principals-and-grants.md)
  and [security](../../topics/security.md) for the existing authority model.
- [Stand-up gap](../../gaps/project-template-standup.md),
  [identity gap](../../gaps/project-local-identity.md), and
  [editor gap](../../gaps/project-template-editor.md).
- [Project captions](../../topics/project-captions.md), its approved identity
  extension, [project names](../../topics/project-names.md), and
  [project directory storage](../../topics/project-directory-storage.md).
- [Server capabilities](../../topics/server-capabilities.md) and
  [hosted compatibility](../../topics/remote-hosted-compatibility.md).
- The actual library at `~/agents/project-templates`: `PROGRAM.md`,
  `FORMAT.md`, `README.md`, `library.json`, selected manifests, `composition.py`,
  and its tests. Read the agents repository's entry instructions and governing
  program chain before editing it. FORMAT.md is the single format authority.

The library landed at agents `d6a64e9` and `4baf1bf`; `eb2dd3c` added the
template illustration and `f3e64ec` added redoc and the flatter source layout.
YA `2bc60b548` holds the initial contracts/mockups, `aad6e4154` the preview
contract, and `526fb1236` the project-local identity contract. Reconcile newer
commits and worktree changes before acting; these are orientation anchors.

Both manifests are still draft. Local materialization, setup, typecheck,
unit/static-server tests, build, browser interaction and optional server
activation passed for both templates. Composition had 13 passing cases.
Fresh examples were `~/agents/tasks/redoc-flat-canvas` and
`~/agents/tasks/redoc-flat-web-page`. These local checks do not establish YA
integration or actual provider discovery/invocation of project skills.

Approved UI source: `packages/client/mockups/project-templates/README.md` and
its sibling TSX/CSS/capture modules. Build instructions are in that README;
the regenerable bundle is `.artifacts/mockups/project-templates/index.html`.
Final desktop/phone captures are under
`.artifacts/captures/project-templates-final-{reservations,workspace,limited-choices,prepare}/`
and `project-templates-final-wide/`. Expiring artifact URLs are not authorities.
Fixture state is in memory, with simulated preparation and no backend calls.

## 1 — Admit and ship a portable template source

Feature enablement is opt-in/default-off in Settings → Project templates.
Provide usable basic source configuration here even though the richer authoring
editor remains a follow-up. Accept the default graehl/agents content or an
alternative local/GitHub source, a repository-relative content root, and
supplementary sources. The overridable default is GitHub repository
`https://github.com/graehl/agents` with content root `project-templates` and a
configurable revision. Fetch on enable and when the origin changes while
enabled; save disabled changes without fetching, then validate on enable.
Cache outside YA's source checkout; a full clone is acceptable initially so
sibling topics and skills resolve. A standalone repository or YA submodule is
not required. The [selective retrieval gap](../../gaps/project-template-selective-retrieval.md)
tracks efficient path/dependency fetching after the agents layout refactor.
Acquisition must retain the complete selected content/dependency closure.
Do not create a new hosted repository or publish merely to satisfy this plan.

Validate root existence, manifests, all references and composition at config
save when enabled, or at enable after deferred retrieval, without executing
setup. Resolve GitHub refs to immutable revisions;
instantiate precisely the validated revision. Revalidate mutable local sources
at creation. Source IDs stay stable across path/revision updates and qualify
permission IDs; supplementary inventories cannot hijack existing selections.
An unavailable source is an actionable error, never an empty successful result.

Implement a YA-native format consumer conforming to the reference compiler;
avoid making the author's Python/acli installation a server prerequisite.
Multiple bases obey dependency and explicit sibling ordering; shared ancestors
appear once. Ordinary collisions require identical bytes and executable mode.
Root AGENTS alone concatenates whole fragments after first-occurrence SHA-256
deduplication. Explicit replace/omit can resolve conflicts; prepend/append cannot
select a conflicting predecessor. No implicit project-file overlays or deep merge.
Across sources, later definitions with matching IDs win; cross-source base
references resolve against that combined inventory. A definition cannot change
between base and template kind. This differs from project-file collision rules.
Constrain `../` and source symlinks to their source repository and materialize
normal files. Reject destination traversal, case/prefix collisions and Git
metadata paths. Do not accept caller-provided script commands or arbitrary maps.

Before production admission, review the portable bases and promote only the
validated App canvas/Web page dependency closures to ready. Do not bypass draft
checks or include legacy-boot wholesale. The open agents gap
`project-templates/gaps/portable-capability-bases.md` owns broader editorial
and experimental tightening; record the reviewed subset and remaining work.
Keep the current reusable UI/testing/software-engineering guidance, excluding
research, runs, agentctl and personal machine policy.

## 2 — Extend existing users, grants and sandbox enforcement

Keep the product terminology **limited user**. Extend existing principals,
not a child-specific parallel identity system. Settings → Users combines
template grants with the existing provider/model/effort and project access
settings. Server-side None / Selected / Any grants are authoritative:

- None and an empty Selected set prevent creation without changing existing
  project access. Any includes future enabled ready templates.
- Selected uses source-qualified IDs. New limited users default to all three
  current templates: App canvas, Storybook and Web page.
  Missing/draft/unavailable selections do not fall back to another template.
- One permitted available choice is automatic; multiple choices show cards.
  No arbitrary source, script, grant or parent-directory fields for limited users.
- New users default Create in to `~/username`, administrator editable. This is
  also their default writable personal-directory sandbox, independent of cwd.
- The administrator may instead lock Current project only. It grants writes
  only to the active project, including one outside the personal directory
  with an explicit new-session grant. Do not intersect that project's writable
  root with the personal directory. View-only does not grant session creation.
- Other paths remain read-only under existing read policy. Filesystem reads do
  not imply YA visibility, view/join/new-session API grants, or confidentiality.
  Limited users never choose sandbox granularity at session creation.

Approved migration: preserve existing users'
project-only confinement and disable template creation until an administrator
grants it; apply the new defaults only to newly created users. Do not silently
broaden old accounts or already-running sessions. Record the eventual decision
in the limited-users and project-templates contracts before migration code.

Enforce the effective principal, locked provider settings, writable root and
permission rechecks through create/fork/resume/join and provider process reuse.
No reused broader session may bypass confinement. Preserve private runtime
state, network policy and refusal on unsupported sandbox hosts. Regular
superusers retain their normal choices. Setup itself executes code: determine
and test the restricted execution identity and writable scope before running
template scripts, rather than sandboxing only the later agent turn.

## 3 — Own creation, setup and one preparation dispatch durably

Reuse the existing project creation path: `POST /api/projects` already supports
explicit directory creation and registration. Start at
`packages/server/src/routes/projects.ts` and `project-creation.ts`, not the
historical topic's claim that YA only registers existing directories.

Add a durable operation identity/state machine covering validation, fresh
target allocation, materialization, setup, Git initialization, registration,
starter availability, preparation dispatch and its outcome. Define each
transition's retry/restart behavior. Repeated clicks, HTTP/relay retries and a
server crash must not overwrite a target, create a second project, or silently
send a second prepare turn. Reconcile ambiguous provider dispatch using durable
session/turn identity; do not claim exactly-once from an in-memory flag.

Run declared argv arrays in project cwd without shell interpolation, with
visible progress and retained bounded logs. Validate prerequisites before a
long setup. Entered intent is user data in the preparation context, not shell
syntax or template source. Reject target/root symlink escapes and races.
Missing roots need explicit resolution, not a fallback to a broader directory.
Keep partial files/logs on failure; never erase an existing or failed directory
automatically. Record enough state for safe, explicit recovery.

After deterministic build, initialize Git, register ownership and display a
working starter immediately. Preparation runs subsequently using the user's
allowed provider/model settings, vendored prompt and entered intent. It refines
AGENTS, README and branding; verifies run/test/build; reports ready to build.
It does not implement the whole requested app during this preparation turn.
Provider failure leaves the starter and failed session visible and retryable.
No provider configured is an actionable blocked-preparation state, not false
readiness. Successful setup and successful preparation are distinct statuses.

## 4 — Make the App pane and names useful beyond the first session

Read `topics/interactives.md` and inspect existing app/artifact routing before
choosing the smallest integration. Relevant existing owners include
`packages/server/src/artifacts/{vhosts.ts,VhostAppControl.ts,VhostAccess.ts,vhost-proxy.ts}`
and `packages/client/src/lib/appHref.ts`. Historical pane proposals are not
proof that lifecycle, static serving or authentication is already implemented.

Consume `.project-template/app.json` for static bundle and command metadata.
Serve the actual built starter through authorized YA access over direct and
relay connections, with correct relative assets. Reopen after server/browser
restart. Subsequent builds must become visible; added-server runtime metadata
must select the new start path. Own server processes, health, exit reporting,
restart and teardown rather than leaving an untracked shell process behind.
Keep private application access distinct from explicitly public publication.

Settings → Apps owns persistent wildcard app-name reservations. First atomic
normalized claim wins within the configured namespace; reserve service names.
Only superusers can clear a reservation. Preserve owner/project tombstones on
stop, deletion, restart and namespace reconfiguration. Claims are independent
of running ports. Clearing an address does not delete project files; explain
loss of the address in confirmation. Handle setup failure without silently
releasing a claim or allowing another user to take it over.

A configured wildcard is optional: template creation and an authenticated App
pane must work without personal DNS. Public host-provided static publication
(for example GitHub Pages) is separate and can serve either template. Creation
does not authorize external publication, account creation, domain purchase or
DNS changes. Account/domain onboarding and writing capabilities remain the
agents `content-authoring-capabilities.md` gap; automatic deployment is not a
completion prerequisite. Console forwarding, annotation and offline PWA work
also remain follow-ups, not implied by a manifest/icon.

## 5 — Integrate the approved creation and settings UI

Use the existing Projects page, AddProjectForm and Settings components with
English i18n keys, supported-server gates and normal loading/error semantics.
Superusers get From template / Existing directory, name, intent and parent.
Limited users get name and intent under their configured root. Template cards
appear only with multiple choices and preserve entered fields on selection.
Use muted illustrative placeholders, not prefilled requirements. Preserve the
existing owner display such as `alex / Sketch garden`; no mandatory username
in the project's own name or directory leaf.

Use the composed `.project-template/preview.svg` as an image, never inline SVG
markup; no setup execution to render inventory. Missing illustrations use a
title/description presentation. Give Web page a content-oriented illustration
if adding one; do not accidentally reuse canvas-only fixture art as its identity.
Show genuine starter availability and preparation state, not a screenshot
pretending to be the resulting app.

Basic source settings and feature opt-in are in scope. The unmocked advanced
editor (ordered bases, extra AGENTS text, conflict preview, local authoring,
copy-to-customize and explicit upstream Update) stays in its existing gap.
Do not silently advance revisions during inventory reads or mutate installed
content. Avoid requiring the advanced editor to enable the first usable flow.

## 6 — Complete portable documentation and protected human identity

The base already vendors `.agents/skills/redoc` and its resources, with an
AGENTS route. Verify actual discovery and invocation on supported harnesses,
including limited-user sessions. README should teach beginners that skills
exist. Redoc keeps the whole doc hierarchy truthful and readable, repairs
links, and refreshes a project-specific `docs/brand.svg` leading README.
This project branding is separate from the template chooser illustration.

Initial name/intent is provisional and creates no protection marker. Only a
deliberate post-creation YA-UI name/caption edit creates root
`.project-identity.json`, for existing/imported projects as well as templates.
Follow the exact schema in project-captions and the vendored redoc reference.
Preserve independent human name/description strings byte-for-byte at the
decoded-string level. Description is humanText + separately editable agentCoda;
the coda owns its separator and can be replaced/removed. Name has no coda.
Do not normalize repeated spaces or Unicode; reject invalid input instead.

This project-local file is the authority, an explicitly approved exception to
app-data-only storage. Private YA metadata alone is insufficient. Do not create
the file for ordinary discovery or automatically ignore it. Fail a human edit
if the record cannot safely persist. Handle malformed versions, escaping
symlinks, concurrent file/UI edits, cache invalidation and independent reset.
Legacy private overrides do not prove a post-creation conscious human edit.

Redoc reads this record before revising README or manifest descriptions,
preserves the human portion exactly, and may update the coda. Do not rename
package IDs/imports/directories/deployment targets as autodoc. Ordinary prose
is freely revisable; no Git-blame ownership ledger or blanket protection for
handwritten docs. Users wanting editorial control may supply their own procedure.

Retain the flatter template layout: root app modules, tests/ and scripts/ for
real artifacts, no superfluous src/ or empty directory placeholders. Prefer
autonomous useful cross-session documentation without making children manage
plans/topics. The agents `gaps/project-document-convention-convergence.md`
keeps directory standardization open: root topics/, gaps/ and gaps/sketches/;
doc/ for additional human-facing material; formal action plans distinct from
sketches. Kyle's docs/topics and docs/plans/T-nnn conventions are additional
read locations for now, not authorization to migrate or adopt them for writes.

## Verification and completion

Use real production routes, persistence and provider/session execution, not
fixture substitutions, for the final integration evidence. Required cases:

| Area | Demonstration |
| --- | --- |
| Usable projects | Create both templates as superuser and limited user; interact with the actual App pane before preparation finishes; observe one real intent-bearing prepare turn; build the requested small app in a subsequent turn. |
| Portability | Remove source access after creation; run/test/build and server:add still work; project instructions and skills have no home-directory dependency. |
| Persistence | Reload/restart through creation stages and after readiness; preserve project, starter, operation outcome and reservation; no duplicate first turn. |
| Permission matrix | None, empty Selected, one, multiple, Any and future inventory; missing source, draft template, revoked grants, forged source/path/script inputs, direct and relay. |
| Sandbox | Personal scope writes a second owned project but not another user's; project-only cannot write a sibling; external explicitly granted active project is writable; view-only launch fails; symlink escape and reused broader session fail. |
| Reservations | Concurrent same-name claims have one winner; stop/delete/restart/reconfigure preserve claim; unauthorized release/takeover fails; superuser clear is explicit. |
| Failure recovery | Setup and provider failure, insufficient prerequisites, existing target and source mutation report truthfully; retry cannot overwrite user files or recreate a successful project. |
| Identity | Creation stays unmarked; later Unicode/spacing-sensitive edits persist for templates and imported projects; redoc preserves human strings while revising coda and manifests; failed writes never show false success. |
| Skills | Actual supported-provider project skill discovery/invocation, with beginner README guidance and restricted-user access. |
| UI/compatibility | Desktop 1200×600 and phone 375×812 captures, sequential typing acknowledged within 100 ms under expected load, keyboard/accessibility behavior, older-server fallback and direct/relay behavior. |

Follow DEVELOPMENT.md's affected-path checks and supported OS/runtime policy;
unsupported limited-user sandbox platforms must refuse clearly, not run loose.
Keep source packaging tests separate from already-installed developer checkouts.
Complete lint/format/typecheck/tests and UI e2e where applicable. Report any
unavailable platform/provider verification explicitly; a mock cannot establish it.

For captures, heed `gaps/artifact-capture-input-ownership.md`: the default helper
may own/delete a caller's bundle when revoking a failed capture. Use a grant URL
or the programmatic capture API with `ownArtifact: false`, then present captures
through the artifact facility. Inspect desktop and phone images sequentially.

Update owning topics and this plan at substantive boundaries, close only gaps
actually satisfied, and retain explicit editorial/editor/publishing follow-ups.
Commit implementation in coherent local units with Topic: project-templates;
do not push or deploy without authorization. No running job is handed over.
The UI approval removes the visual-design blocker, not these integration tests.

Source session: codex | 01a0c113-abb9-7b72-96a6-c00ee8ab67c5
