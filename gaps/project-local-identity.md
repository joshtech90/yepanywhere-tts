# Human identity edits are private to YA and unavailable to redoc

YA's `ProjectMetadataService` stores chosen names and captions in private app
data. Name/caption routes do not write a project-local record or separate a
human description from an agent coda. The portable redoc skill therefore
cannot honor a YA-UI edit without receiving that context separately.

Implement the user-approved
[identity contract](../topics/project-captions.md#approved-project-local-identity-extension-not-implemented)
for **all** projects, not just templates. The contract is stated only there;
this entry holds what it leaves to implementation:

- Existing app-data overrides: reconcile them without inferring that a
  creation-time choice was a later human edit.
- Cache invalidation when the project-local record changes outside YA.
- Removal and re-add of a project that has a record.
- Capability gating and client behavior against servers without the record.

Verify a plain imported project as well as both starter templates. A creation
value must remain revisable with no record. Then manually change a name and a
description containing Unicode, repeated spaces and deliberate punctuation;
run redoc outside YA and prove the stored human strings and their README
projections stay exact while an agent coda changes. Verify manifest description
projections without renaming package IDs. Exercise separate human and coda
edits, reset of one field without erasing the other, persistence across restart
and re-import, and all write-failure/concurrency cases the contract names.

Deferred from template-content work because it changes existing metadata,
storage policy and APIs; no runtime implementation is claimed here.

Found 2026-09-21 while defining the redoc skill and human identity preservation.
Contributing-model: 6-Astra.
