# Two MessageInput toolbar tests fail: the viewer docks parked, not open

`packages/client/src/components/__tests__/MessageInput.test.tsx` fails two
tests on `main`:

- `renders the file viewer controller in the toolbar center gap`
- `renders activity viewer minimize and close controls in the same dock`

Both look for a `Close <viewer>: <target>` button and find only
`Restore <viewer>: <target>`. The controller renders with
`data-file-viewer-state="parked"` and the `_parked_` class, at
`left/top/width/height: 0px`, so the dock is in its minimized state where
the test expects the open one.

Bisected to `28a171e43` "Give the viewer toolbar one close descriptor": the
tests pass at its parent `9aabaaf6e` and fail at `28a171e43` itself, before
any of the 2026-09-19 session-rewind or Project Queue work. That commit
reworked `sessionViewerController.ts`, `useSessionRightPane.ts`, and
`SessionViewerToolbarController.tsx` and added
`SessionViewerToolbarController.test.tsx`, which passes — so the new
single-descriptor model is covered, and these two older tests were left
asserting the previous open/close labelling and initial dock state.

The fix is a judgment call the commit's author should make, because the two
readings differ: either the parked-on-mount state is the intended new
behavior and these tests should assert `Restore` (and drive a restore before
expecting `Close`), or docking parked is itself the regression and the
controller should mount open. Nothing here says which; `topics/parked-file-viewer.md`
gained 12 lines in that commit and is the place to check.

Not fixed in place: it is unrelated to the queued-YA-command/clearloop-patience
work that ran into it, and it sits inside an actively-shaped feature whose
intended default this session has no basis to choose.

Found 2026-09-19 while running the full unit suite for the Project Queue
queued-YA-command and patient `/clearloop` change.
