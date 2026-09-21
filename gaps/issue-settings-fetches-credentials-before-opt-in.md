# Issue settings fetch the credential inventory whether or not confirmation is on

`ConfirmationControls` renders whenever settings have loaded
(`packages/client/src/pages/settings/IssueSettings.tsx:202`) and its mount
effect fetches `/issues/credentials` unconditionally (`:240`). Only the
*display* of that inventory is gated on `confirmation.enabled`. The test named
"keeps confirmation off and its credentials hidden until opted in"
(`packages/client/src/pages/settings/__tests__/IssueSettings.test.tsx:112`)
asserts that no `/issues/credentials` call has happened yet, which holds only
while the effect from the render that produced the checkbox has not flushed.

That makes the test a load-sensitive flake — it failed once during a full
client suite run and passed on re-run and in isolation — and the flake is
hiding the more interesting question. Waiting properly for the checkbox
(`findByRole`) turns the failure into `expected true to be false`: the fetch
has by then certainly happened.

Decide which is true and make both the code and the test say it:

- if the inventory should not be read until the user opts in, gate the effect
  on `confirmation.enabled` and keep the assertion; or
- if reading it eagerly is fine (it reports only which sources are present,
  never a key), rename the test to the contract it actually checks — the
  inventory is not *shown* until opted in — and drop the fetch assertion.

Not fixed in place: it is someone else's feature area, the right answer is a
product call rather than a test repair, and the adjacent work was an unrelated
reverse-search fix.

Found 2026-09-19 while clearing pre-publish test failures.
