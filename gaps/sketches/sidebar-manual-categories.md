# Sidebar categories: rename, delete, reorder, duplicate hiding

Manual categories, per-limited-user sections, and click-the-name section
headers shipped 2026-09-28; the contract lives in
[sidebar session ordering](../../topics/sidebar-session-ordering.md#sections).
This sketch keeps what v1 left out.

- **Rename and delete a category.** A category is only a name stored on each
  filed session, so renaming or deleting one today means refiling each
  session. A header menu could do it in one step; the server would need a
  bulk update (or the client would issue one metadata write per loaded and
  unloaded filed session, which the categorized feed can enumerate).
- **Empty categories.** A category disappears when its last session leaves.
  Keeping empty ones would need a stored category list, which also decides
  whether categories are per principal or shared with limited users.
- **Section order.** v1 fixes the order: Starred, categories by name, Last 24
  Hours, limited users by name, Older. User direction: no drag-to-reorder in
  v1. Up/down items in a header menu are a cheap first control.
- **Duplicate-title hiding in named sections.** `groupDuplicateSessions` runs
  only on Last 24 Hours and Older; category and per-user sections show every
  row.
- **Several categories per session** (tags) was not requested; one category
  per session keeps "each session appears once" simple.

No implementation is approved by this sketch.

Contributing-model: opus-5-5
