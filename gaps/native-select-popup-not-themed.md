# Native `<select>` popups ignore the YA theme

Every `<select>` styled with the shared `.settings-select`
(`packages/client/src/styles/index.css:8834`) colors only the closed control.
The open option list is drawn by the browser from the element's `color-scheme`
plus UA defaults, so it does not follow YA's palette.

It is worst under the default `auto` theme (`index.css:742`,
`color-scheme: light dark`): the CSS variables fall back to the dark values
while a light desktop makes the browser paint the popup white with grey option
text and a harsh blue highlight, hanging off a dark control. Reported
2026-09-20 with a capture of the Settings → Users project-access select.

Cheap fix, once, beside `.settings-select`:

```css
.settings-select option {
  background-color: var(--bg-surface);
  color: var(--text-primary);
}
.settings-select option:disabled {
  color: var(--text-muted);
}
.settings-select {
  accent-color: var(--accent-color);
}
```

Not fixed in place because `index.css` sits exactly at its
`scripts/css-architecture-baseline.json` ceiling (15641 lines), so adding the
rule requires extracting at least as many legacy lines from the same file —
its own bounded slice, per `topics/css-architecture.md` § Contract. Settings →
Users carries the equivalent rule in its own CSS module meanwhile, so the fix
is already written and needs only an owner and an offset.

Found 2026-09-20 while moving limited-user management into Settings → Users.
