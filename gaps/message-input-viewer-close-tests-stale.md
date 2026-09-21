# Two MessageInput tests look for viewer close buttons by a retired name

`packages/client/src/components/__tests__/MessageInput.test.tsx` fails at
`main` in two cases:

- "renders the file viewer controller in the toolbar center gap" expects a
  button named `Close file viewer: /workspace/docs/guide.md:12`;
- "renders activity viewer minimize and close controls in the same dock"
  expects `Close detail view: Bash Command`.

Neither accessible name is rendered any more. `28a171e43` ("Give the viewer
toolbar one close descriptor") unified the close control's descriptor, and
the rendered controller now exposes a `group` named `Detail view: …` with no
button carrying the old `fileViewerClose` / `sessionViewerClose` labels (both
strings still exist in `en.json`). The tests were last touched by `b2755685e`
and were not updated with the descriptor change.

Not fixed here because the intended accessible name of the unified close
control is the viewer toolbar's design decision, not a rewind concern. The
cheap fix is to assert on the descriptor the toolbar now renders (or restore
the per-viewer close label if that was the intent) and delete this entry.

Found 2026-09-19 while running the full suite for the session-rewind
hardening commit.
