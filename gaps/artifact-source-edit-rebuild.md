# Artifact rebuilds can leave partial outputs, lose the reading position, and cannot be cancelled

The approved rebuild hook, `POST /api/file-edit/rebuild`, and the preview swap
are implemented; their contract is
[Rebuild after source save](../topics/file-source-editing.md#rebuild-after-source-save).
Three parts of that contract remain unbuilt:

- **No snapshot of the last good outputs.** `ArtifactRebuildService` runs the
  registered command against the live output paths. A producer that fails
  partway leaves partially written HTML, assets or map on disk, and the next
  preview read shows them. Fix sketch: copy the registration's `outputs` aside
  before the run, restore them when the run fails or times out, and publish
  HTML, assets and map together only after success.
- **The swap loses the reading position.** `SourceEditor` replaces the preview
  with the re-read HTML and does not capture or restore where the reader was.
  Fix sketch: the scroll-fraction first delivery, then the map-anchored
  restoration, both described in the topic section above.
- **A running build cannot be cancelled from the editor.** Neither the route
  nor the service accepts a cancel; a run ends only on exit or its registered
  timeout. Fix sketch: a cancel request for the in-flight artifact/hook run
  that reuses the timeout's process-tree stop, with a Cancel control beside
  the running state.

Also unresolved: how a Plannotator-wrapped artifact discovers its hook and
refreshes the right embedded revision. The ordinary `ya-artifact:v1`
convention does not cover that wrapper's lifecycle.

Found 2026-09-22 while implementing source editing with accepted rebuild
deferral; narrowed 2026-09-27 to the remainder after the rebuild trigger
landed.
