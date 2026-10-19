# Chosen prose font intermittently falls back until reload

On `localhost:3400`, assistant prose in conversation view sometimes renders in
a default-looking font instead of the chosen Appearance prose font (Source
Serif 4). A reload always restores it. The observed occurrence followed a YA
server restart after the page loaded; the view had live streaming updates and
rendered inline math.

Not reproduced yet. What the code rules out and suggests:

- The setting is applied once at startup as inline custom properties on
  `<html>` (`initializeOutputAppearance` in
  `packages/client/src/hooks/useOutputAppearance.ts`, called from
  `packages/client/src/main.tsx`), and afterwards only the Appearance page
  writes them. No client code clears or rewrites the root's inline style, and
  assistant text always renders under `.assistant-turn .text-block-assistant`,
  which takes `--output-prose-font-family`
  (`packages/client/src/styles/renderers.css`).
- Leading hypothesis: the single Source Serif 4 face
  (`@font-face` at the top of `packages/client/src/styles/index.css`) is
  fetched the first time prose needs it. A fetch made while the server is
  restarting fails, and the browser keeps that face failed for the
  document's life, so the stack falls to Georgia, then the generic serif.
  On a host without Georgia that can look like the default font. Only a
  reload retries the fetch.

A passive capture is installed for this
(`packages/client/src/lib/diagnostics/fontDiagnostics.ts`). When a bundled
font face fails to load or the prose-font property changes, it keeps the event
in `window.__yaFontDiagnostics` (last 50) and records it as `[FontLoad]` in the
client log, which reaches the server only while Developer log collection is
on. It stays off the console, whose warnings are reserved for actionable
conditions (`topics/console-chatter.md`). Remove the capture, or make it opt-in,
in the commit that closes this gap; nobody should have to remember to turn it
off.

Next occurrence, before reloading, record from the console
`window.__yaFontDiagnostics` and:

```js
[getComputedStyle(document.documentElement).getPropertyValue('--output-prose-font-family'),
 [...document.fonts].filter(f => f.family.includes('Source Serif')).map(f => f.status)]
```

`var(--font-output-serif)` with status `"error"` confirms the failed fetch;
then retry failed bundled faces (for example a fresh `FontFace(...).load()`
added to `document.fonts`) when the server connection recovers. A value of
`var(--font-sans)` means the setting itself was dropped, through a path this
search missed. Also note whether scrolling back or switching sessions changes
it, which separates one render path from the whole document.

Found 2026-10-18 while working on project app controls, from a user report.
