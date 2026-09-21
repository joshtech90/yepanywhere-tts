# Client unit tests emit unwrapped React update warnings

The full `pnpm test` run emits React "not wrapped in act(...)" warnings from:

- `packages/client/src/pages/__tests__/IssuesPage.test.tsx`, in all three
  associated-session checks; and
- `packages/client/src/components/__tests__/SessionViewerToolbarController.test.tsx`,
  in the vhost dismissal and busy-action checks.

The assertions pass, but the asynchronous updates are not settled through the
test's user-visible interaction boundary. Update the tests to await those
updates with Testing Library/Vitest primitives and confirm the warnings
disappear without suppressing React diagnostics.

Found 2026-09-20 while running the required checks for the principals-and-grants
documentation change.
