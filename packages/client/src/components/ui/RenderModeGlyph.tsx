import styles from "./RenderModeGlyph.module.css";

/**
 * The Sigma glyph that marks a render-mode toggle, as markup rather than JSX:
 * `useCodeFenceRenderers` builds its toggle in plain DOM, outside React, and
 * both surfaces must draw the same glyph. Anything that needs it from React
 * renders `RenderModeGlyph`.
 */
export const RENDER_MODE_GLYPH_MARKUP: string =
  '<svg class="render-mode-glyph" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<text x="8" y="8.1" text-anchor="middle" dominant-baseline="central" ' +
  'font-family="KaTeX_Main, Times New Roman, serif" font-size="12.5" font-weight="500" ' +
  'fill="currentColor">Σ</text></svg>';

export function RenderModeGlyph() {
  return (
    <span
      className={styles.host}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed in-repo markup, shared with the plain-DOM code-fence toggle
      dangerouslySetInnerHTML={{ __html: RENDER_MODE_GLYPH_MARKUP }}
    />
  );
}
