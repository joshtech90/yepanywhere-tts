# Comment from a project browser opened in another tab

The embedded project browser can insert a path, optionally followed by a
selected quotation, into its containing session's draft and focus the composer.
The action never sends a turn. A standalone tab has no established destination
session and currently offers copy actions only.

Possible extensions, requested 2026-10-26:

- Remember the last session for each project in client storage, scoped to the
  connected YA source and signed-in user. This is a candidate destination, not
  authority to send a message or overwrite an existing draft.
- Propagate session context through project-browser new-tab navigation. Keep
  the YA session ID distinct from the app's `ya_access` bearer token. A token
  granting app access does not grant session access.
- Offer an inline composer in the standalone browser once an authenticated
  destination is available. Show the project and destination session before
  forwarding to its draft; preserve existing draft text and require an explicit
  send in YA. Resolve stale, deleted, inaccessible or ambiguous destinations
  visibly instead of silently choosing another session.

No client storage, cross-tab routing, session picker, or standalone composer is
implemented by the embedded comment bridge. The portable repo-view base must
remain useful without YA.

Contributing-model: 6.1-Sol
