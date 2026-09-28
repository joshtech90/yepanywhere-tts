# Editing a gateway service's id drops focus after one keystroke

The services editor (`GatewayServicesSettings` in
`packages/client/src/pages/settings/GatewayServicesSettings.tsx`) keys each
entry's `<fieldset>` by `service.id`, and the id is itself an editable field.
The first keystroke in the id input changes the key, so React unmounts that
entry and mounts a new one: the input the user is typing into leaves the
document and focus goes with it. Every later keystroke is dropped, which
breaks the project rule that no keystroke is ever lost. A jsdom probe
confirmed the typed-into input is detached after one change event.

Not fixed with harsh-review F30 (blur-save reconciliation) because it needs
its own identity change: the fix is a stable client-side key per entry, kept
through add, remove and reorder (for example a key list maintained alongside
the draft), so an entry's DOM, focus and `<details>` open state follow the
entry rather than its id or its position. Add a sequential-typing test that
types a multi-character id.

Found 2026-09-26 while fixing harsh-review F30 [3-2].
