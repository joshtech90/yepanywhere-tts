# Five copies of the fixed-font math panel renderer

`renderFixedFontMathPanel` (and `renderReadMathPanel`) is written out
separately in `BashOutputDetail.tsx`, `BashOutputRenderer.tsx`,
`EditRenderer.tsx`, `ReadRenderer.tsx`, and `WriteStdinRenderer.tsx` under
`packages/client/src/components/renderers/tools/`, plus an inline variant in
`BashRenderer.tsx`. They differ only in the outer class and whether the inner
element carries `styles.fixedWidthOutput`. Each had to be edited separately to
stop rebuilding its DOM on every render.

Cheap fix: one `FixedFontMathPanel` component beside `FixedFontMathToggle`
taking the outer class and an optional inner class, rendering `InnerHtml`.

Found 2026-09-29 while routing every `dangerouslySetInnerHTML` through
`InnerHtml`.
