# Session right pane — sketches

Candidate extensions to [session-right-pane](session-right-pane.md), not
initial-version behavior.

## Browser-style viewer tabs

Requested 2026-09-16: an optional standard browser-tabs display for multiple
viewer windows. This replaces the earlier ad-hoc recent-viewer selector idea.
The initial version retains one viewer, with minimize-to-bottom and close,
matching the modal viewer's existing controller.

- A conventional tab strip shows viewer titles, the active tab, and per-tab
  close buttons. Files, live apps, and other managed viewers share the same
  session-owned tab model; switching never creates another session renderer.
- Ctrl-Tab advances and Ctrl-Shift-Tab goes backward in visual tab order,
  wrapping at the ends, as confirmed by the user.
  Browsers may reserve these keys for actual browser tabs; the implementation
  must provide visible switching controls and a configurable alternate shortcut
  rather than claiming it can intercept a browser-reserved key everywhere.
  Plain Tab and Shift-Tab retain focus traversal.
- Switching preserves each retained viewer's mounted state. Minimize parks
  the group at the bottom controller, and restore returns to the active tab.
  Closing one tab selects a neighbor; closing the last removes the controller.
- The display is an option, not a new default. Narrow screens may use a compact
  tab list when the strip cannot provide useful touch targets.
- Retention limits, background app work, reload persistence, browser-history
  interaction, and the shortcut fallback need explicit decisions before
  implementation. Live iframe apps cannot be assumed idle merely because
  their tab is hidden.

This extends the existing [parked-viewer multi-window sketch](parked-file-viewer.sketches.md#multi-window-tabs-of-recent-viewers).
