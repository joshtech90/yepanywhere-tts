# Let a public session share view the project's App

A session share shows the transcript, but a viewer cannot see the project App
the session was driving (for example a puzzle simulator whose state the
conversation discusses). The owner wants share viewers to be able to view it.

Not built yet because "read-only" has no precise meaning for an App. A view
that forbids all input is unusable for most apps (even scrolling or selecting
a level is input), while one that forwards input lets a viewer mutate the
owner's running app. A design has to decide at least:

- whether a viewer gets the live owner instance, a mirrored/snapshotted view,
  or a separate per-viewer instance;
- which requests count as reads (GET only is not reliable for app APIs);
- how the share's bearer secret maps onto the App proxy's existing bearer and
  public modes (`gaps/sketches/app-public-access-with-identity.md`,
  `topics/relay-origin-and-share-gating.md`), without granting the share
  viewer the owner's App access token.

Requested 2026-10-15 alongside the public-share attachment thumbnail fix.
