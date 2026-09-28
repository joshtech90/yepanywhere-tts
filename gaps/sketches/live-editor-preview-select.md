# Live interactive pane inside the source editor

Status: sketch, not scheduled. Owner topic:
[file-source-editing](../../topics/file-source-editing.md).

## What exists

Edit mode's preview is a scriptless snapshot in an opaque-origin `srcdoc`
frame. The **styled preview** toggle (landed 2026-09-23) lets that snapshot
load real stylesheets, images, and fonts through an artifact grant, so the
common case, a built report or paper canvas, renders correctly while plain
click still selects a mapped item.

## What this would add

Running the real artifact, scripts included, inside the edit workspace, with
Alt-click selecting a source target while ordinary clicks reach the app. The
user judged the click-intercepting facility useful in its own right, beyond
the editor.

## What it needs

- **Target attribution in the live DOM.** The snapshot path computes
  `data-ya-edit-target` client-side from the producer's paired HTML comments
  (`parseArtifactSourceTargets`). A served artifact has the comments but no
  attributes, so the injected bridge must perform the same comment walk in
  the live document, or the artifact server must annotate HTML on serve.
  Server-side annotation keeps one parser; do not duplicate the walk in
  injected script.
- **Bridge injection.** The artifact server would append a small script to
  served `.html` under a grant when the request carries an opt-in query, with
  capture-phase `click` that acts only on `altKey`, calls `preventDefault`,
  and posts `{type, nonce, id}` to the parent. `ARTIFACT_CSP` currently sets
  only a `sandbox` directive, so no nonce-based `script-src` change is needed.
- **Parent trust.** `SourceEditor` currently accepts messages only from the
  `srcdoc` frame with `origin === "null"`. The live pane would accept the
  grant's origin instead, still keyed on the per-editor nonce, and still map
  ids only through the parsed target list. A producer script can read the
  nonce from its own DOM and spoof a selection of one of its own declared
  targets; that reaches the allow-set-gated `/file-edit` read only, so it is
  a nuisance, not a boundary break. Record that judgment in the topic when
  implementing.
- **Touch.** No Alt key on touch; the pane needs a "select target" toggle
  that makes plain taps select.
- **Staleness.** A live pane can reload after a save, which would close
  [artifact-source-map-staleness](../artifact-source-map-staleness.md) for
  artifacts whose rebuild is external and fast.
