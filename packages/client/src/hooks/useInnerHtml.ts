import { useMemo } from "react";

/**
 * A `dangerouslySetInnerHTML` value whose identity is stable while its markup
 * is unchanged.
 *
 * React 19 compares this prop by object identity and rewrites `innerHTML`
 * whenever a new `{ __html }` object arrives, even when the markup is
 * byte-identical. A component that re-renders during live agent activity
 * would therefore rebuild its DOM on every update, and rebuilding the text a
 * reader is drag-selecting removes the selection's anchor: the browser drops
 * the drag, and the selection clears before it can be copied. Pass every
 * `dangerouslySetInnerHTML` through this hook (or a module-level constant) so
 * identical markup never touches the DOM.
 */
export function useInnerHtml(html: string): { __html: string } {
  return useMemo(() => ({ __html: html }), [html]);
}
