# Project-template integration remains incomplete

The source library and local materializer exist in the default source's
[`project-templates`](https://github.com/graehl/agents/tree/master/project-templates)
directory. YA now offers authorized creation through a radio palette in Projects
and an inline New session expansion. Native setup, Git initialization,
registration and preparation dispatch are connected. Settings → Users has
None / Selected / Any template grants, enforced by the server. Limited-user
setup runs in the project-write sandbox. App-pane integration, personal
workspace scopes and the full recovery contract remain unfinished.

The agreed format and product behavior live in
[project templates](../topics/project-templates.md#current-contract--config-driven-templates).
This gap tracks the unimplemented YA half. All existing UI prototypes were
approved on 2026-09-21; the
[implementation handoff](../docs/tactical/132-project-template-implementation.md)
compiles the delivery sequence and acceptance boundary. The prototype manifests
require the separate agents instruction-library review; production must not
silently allow drafts. All three default templates and their dependency
closures are now admitted in the agents source. Remote sources must be updated
after publication to receive those manifest changes.

The native loader/composer now exists in
`packages/server/src/projects/template-library.ts`; its conformance tests cover
inventory validation, ordering, collisions, text overrides, source containment
and draft refusal. It materializes ready closures through the creation operation.
Settings accepts an ordered GitHub/local source
list, pins fetched revisions, relocates retrieved repository aliases and
validates the combined inventory. Local overlays are read directly.
See tactical 132's current checkpoint for verification and exact remaining work.

## What a user sees today

User-directed placement revision (2026-09-28): New project always shows template
choices as a radio palette, even for one choice. New session may use a dropdown
trigger but must accept a new project name and offer quick inline creation
without navigating away. The mockup-first fixture is
`packages/client/mockups/project-template-placement/`; it does not close this
runtime gap. Optional template-provided thumbnails/icons have a separate
[specification sketch](sketches/project-template-artwork.md).
Contributing-model: 6-Astra.

With templates enabled and a ready source configured, permitted users can create a
project and start preparation through either entry point. The chooser rereads
mapped SVG images when reopened. Its source must have been explicitly updated
to receive remote changes. Limited-user grants are configured in Settings →
Users and enforced before creation and at operation boundaries. The original
missing-template report was made on 2026-09-28. The remaining workspace, App
and recovery acceptance keeps this gap open.

## Plan to close

The contract is complete in
[project templates](../topics/project-templates.md) and
[limited users](../topics/limited-users.md), the delivery order in
[tactical 132](../docs/tactical/132-project-template-implementation.md),
and the source side in the agents repository's `project-templates/`
program and its `gaps/portable-capability-bases.md`. What remains is
implementation. Ship it as vertical slices, each usable and
releasable on its own:

1. **Content admission (§1), implemented.** All three default templates and
   their dependency closures are ready; legacy boot remains draft and unused.
2. **Superuser creation acceptance (§3, §5).** The native endpoint and both
   forms are implemented and verified through a real browser with a mock
   provider. Complete live App canvas preparation and recovery verification;
   reconcile queued launches and abrupt crashes without duplicate preparation.
3. **Grants (§2), implemented.** Server-enforced None / Selected / Any on the limited-user
   record and in Settings → Users, defaulting to Any when the user has a
   project root (user-directed 2026-09-28), with the one-time migration of
   existing users.
4. **Limited-user creation (§2, §5), core implemented.** Configured root,
   filtered ready templates, project-write setup and owned registration are
   verified through the real browser and server with a mock provider. Personal
   workspace scopes and the private-apps ceiling remain with App integration.
5. **App names and pane (§4)**, then **documentation (§6)**, as the tactical
   orders them.

Slices 1 and 2 are the shortest path to a template that actually creates a
project; the grant UI is not useful before creation exists.

## Remaining integration

- User report, 2026-09-28: a limited user may be unable to create an App pane
  or start the template app. Reproduce both separately. Local `*.localhost`
  routing must work without configuring the maintainer's public wildcard.
  The existing public-name design is first successful claim, persistent
  reservation and superuser-only release, scoped to the configured wildcard;
  it is not implemented merely because `*.graehl.org` exists.
- [Own-session lists and images](limited-user-session-visibility-and-media.md)
  have separate reported access failures. Template boilerplate also becomes
  the session title; provide a meaningful title/preview from the user's intent
  without hiding the actual setup instructions from the transcript.
- Approved administrator controls, 2026-09-28: a per-limited-user choice of
  whether standard harness-global instructions are imported into its isolated
  harness home, and administrator-editable instructions before and after
  template setup. These must not require children to inherit the maintainer's
  personal global context. See the existing
  [harness discovery gap](sandbox-harness-instruction-read-access.md).
  Template-specific settings visible in the chooser remain sketch-only.
  Contributing-model: 6-Astra.

- Creation grants now bind to source and template identity. Efficient
  retrieval and cache retention have their own
  [gap](project-template-selective-retrieval.md).
- Extend the native materialization/setup checks to supported platforms and
  restricted principals. Complete durable setup-log checkpoints, queued launch
  reconciliation, ownership and app-name reservation. Existing operation IDs
  already prevent replay and fresh allocation refuses existing targets; abrupt
  crashes must also account for surviving setup processes and dispatched sessions.
- Vendor declared skills into normal project discovery directories with their
  complete resources. Verify discovery/invocation in supported harnesses and
  beginner-facing README onboarding, including under limited-user permissions.
- Persist wildcard app-name reservations independently of running ports and
  project lifetime. First successful claim wins; only the superuser clears
  a reservation. Settings → Apps shows owners and retained orphaned entries.
  Verify concurrent claims have exactly one winner, and stop/delete/restart or
  namespace reconfiguration cannot silently release a name. Test attempted
  release/takeover by limited users and recovery after partial setup failure.
  Store the reservation's public/private state and enforce the
  [Private apps only](../topics/limited-users.md) ceiling server-side against
  forged creation and row-update requests.
- Show the usable starter as soon as deterministic setup has built it, then
  auto-send the project-context prepare turn with intent. Keep setup, agent
  preparation and readiness distinguishable; agent failure retains the starter.
- Complete the app-exposure ceiling alongside App integration. Template
  grants, configured project root, provider locks, project-write setup,
  ownership and operation permission rechecks are implemented.
- Implement the
  [workspace direction](../topics/limited-users.md#approved-workspace-direction-2026-09-21-not-implemented):
  Create in defaults, the two superuser-locked write scopes, and the one-time
  migration of existing users. Separate API project grants from filesystem
  write scope. Cover create/fork/resume/join and reused provider processes so
  none retains a broader principal's writable mounts. Preserve private runtime
  state, network confinement and unsupported-host refusal. Reject missing
  roots and symlink escapes.
- Extend the implemented New project UI and older-server capability gate to
  the remaining limited-user and workspace contracts recorded in tactical 132;
  existing capabilities retain their meanings.

## Closure evidence

Create App canvas through YA's actual endpoint/UI, with no manual copying or
handcrafted test-only stand-up. Verify the README-derived description, initial
Git state, usable App pane before preparation completes, intent in the one
preparation turn, commands and readiness after preparation. Test retry and
failure states, including revoked permissions and unavailable sources.

For personal-directory sandboxing, start in one owned project and prove a write
to a second owned project succeeds, while writes to a sibling user's project,
an escaping symlink and host paths fail. Prove those writes fail outside the
active project when project-only mode is locked by the superuser. In that mode,
grant new-session access to a project outside the personal directory: prove
writes inside that project succeed while writes to the user's other projects
fail. A view-only grant must not permit such a launch. Verify outside reads still
follow existing policy and no API project grant is implied by filesystem reads.

Exercise None, one, several and Any permissions through direct HTTP and relay;
try forged template/source/path inputs, path traversal and source symlink
escapes. Test a source changing between validation and creation. Materialize
then remove access to the source and prove build/test/run plus adding a server
still work. Verify project creation and instructions across supported platforms,
and desktop/phone UI including real sequential typing under concurrent updates.

Pane console forwarding/annotation, extra templates and publishing are separate
follow-ups; the current starter does not implement them. The isolated mockup is
not evidence of YA creation or authorization behavior.

Found 2026-09-21 while building the initial template library and reviewing its
YA integration. Contributing-model: 6-Astra.
