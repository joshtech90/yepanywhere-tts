# Human identity edits are private to YA and unavailable to redoc

YA's `ProjectMetadataService` stores chosen names and captions in private app
data. Name/caption routes do not write a project-local preservation marker or
separate a human description from an agent coda. The new portable redoc skill
therefore cannot honor a YA-UI edit without receiving that context separately.

Implement the user-approved
[identity contract](../topics/project-captions.md#approved-project-local-identity-extension-not-implemented)
for **all** projects, not just templates:

- On a deliberate post-creation name/caption edit, write the exact chosen text
  to root `.project-identity.json`. No marker for initial setup values, ordinary
  discovery, agent-generated wording or merely opening a project. Preserve
  independent name/description entries and the later description's agent coda.
- Treat the file as authority for this preservation behavior. Private app data
  may cache/index it, but cannot be the only durable record. This is an explicit
  exception to App data only storage. Do not auto-ignore or silently drop it.
- Fail the edit if the project record cannot be safely persisted. Cover
  read-only projects, escaping symlinks, malformed/unknown versions, races and
  crash recovery; do not leave private UI success with no portable record.
- Add a coda update path that cannot change protected fields, and expose human
  text/coda independently in the human editor. Preserve exact strings rather
  than normalizing them through existing name/caption validation. Enforce
  length/content rules by rejecting invalid input, never rewriting it.
- Reconcile existing overrides without inferring that a creation-time choice
  was a later human edit. Define cache invalidation for local record changes,
  removal/re-add behavior, and supported-server capability/migration behavior.

The file contract is also vendored with redoc under the agents library's
`project-templates/bases/base/redoc/references/project-identity.md`. Ordinary
doc revision remains unrestricted autodoc unless the user supplies another
procedure; no author detection, git-blame ownership or general prose ledger.

Verify a plain imported project as well as both starter templates. A creation
value must remain revisable with no marker. Then manually change a name and a
description containing Unicode, repeated spaces and deliberate punctuation;
run redoc outside YA and prove the stored human strings and their README
projections stay exact while an agent coda changes. Verify manifest description
projections without renaming package IDs. Exercise separate human and coda
edits, reset of one field without erasing the other, persistence across restart
and re-import, and all write-failure/concurrency cases above.

Deferred from template-content work because it changes existing metadata,
storage policy and APIs; no runtime implementation is claimed here.

Found 2026-09-21 while defining the redoc skill and human identity preservation.
Contributing-model: 6-Astra.
