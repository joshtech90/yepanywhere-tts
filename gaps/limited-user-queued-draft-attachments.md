# Carry account-owned draft uploads through Project Queue

Limited users can stage attachments for ordinary new sessions and template
preparation. Their draft staging index is isolated by account. Project Queue
still transfers and materializes attachments through the superuser staging
service, so a limited user's new staged reference is refused there.

Thread the authenticated draft owner through queue admission and preserve
ownership through updates, dispatch, rollback and cleanup. An editor of another
user's queue item must not gain access to that user's other drafts. Do not
search every account's staging store for a supplied reference.

The direct/new-template attachment fixes do not claim this queue path. Add
integration coverage for limited-user queue admission, restart, dispatch and
cross-account forged references before closing this gap.

Found 2026-09-28 while fixing limited-user composer uploads.
Contributing-model: 6-Astra.
