# Growable settings collections

> Settings lists with per-item options use compact summary tables and one
> selected item's options pane, keeping the list usable as it grows.

Topic: settings-collections

## Layout convention

Domain names and suffixes in Apps inventory rows remain single lines with
ellipsis when space is tight. Opening a neighboring detail pane must not turn
the inventory into tall wrapped rows; the selected item's full name remains
available in its detail pane and the domain name's hover title.

Use this pattern for user-created collections such as Apps domains and project
apps when each item has an options block. Show identifying information and a
few useful comparison columns in a semantic table. Keep inputs, explanatory
copy, and secondary actions in the selected item's pane instead of repeating
a full form under every row. A short list with only one immediate action per
item does not need an options pane.

Each row has a named expansion button with `aria-expanded`. Opening a row
shows its options in the neighboring column; opening another replaces that
pane. The selected row is visibly marked. The pane has the item's name as its
heading and a **Back to list** control. Closing it gives the table its full
width again. Collection and pane scrolling are bounded on wide layouts so a
long list does not push all later settings below dozens of forms.

When the collection's available width cannot comfortably fit both columns,
show either the table or the selected pane. **Back to list** restores the
table, its scroll position, and focus on the originating control. Do not
squeeze two desktop columns into a phone or expand a long editor inside its
table row. Let narrow detail panes scroll with the page, and keep touch
controls at least 44 pixels high.

## Editing and identity

Selecting a row changes presentation only. Keep the collection's existing
save, validation, error, capability, and access-control behavior. Read-only
collections still allow opening and closing panes with editing controls
disabled. Closing a pane must not discard unsaved edits; field blur still commits where
the collection uses autosave. Save completion must not overwrite newer typing.

Use stable item identities for selection and React keys. An editable name,
domain, or array position is not an identity: typing a name or removing a
neighbor must not remount an editor or select the wrong item. New rows open
their options immediately. Removing the selected item closes its pane.

Move focus into the opened pane, which also makes the mobile transition
usable without hunting below a hidden list. Use native buttons, tables, and
labeled form controls; do not add custom grid keyboard semantics unless the
interaction actually needs a spreadsheet.

## Current owners and verification

`packages/client/src/pages/settings/SettingsCollection.tsx` owns the common
layout and pane navigation. `ArtifactSettings` supplies the manual domain
table and editors; `ProjectAppInventorySection` supplies project summaries and
the existing `ProjectAppViewer` settings controls. Their API and persistence
contracts remain with those owners. [Settings placement](settings-ui-placement.md)
owns category and persistence choices; [UI testing](ui-testing.md) owns captures.

Verify with a populated collection, not just one row: open, switch, close,
add and remove; type sequentially while a save is pending; reload to confirm
persistence. Inspect wide and phone captures of both the table and an open
pane. Check selected-row visibility, column width, long domains/paths, keyboard
focus, and that no sibling editor remains mounted. The Apps cases in
`packages/client/e2e/session-right-pane.spec.ts` exercise forty domains and
check each typed character within 100 ms during a delayed save.
