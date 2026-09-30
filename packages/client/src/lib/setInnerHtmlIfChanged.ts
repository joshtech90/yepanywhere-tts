const writtenMarkup = new WeakMap<Element, string>();

/**
 * Replace `element`'s content with `html` unless this helper already wrote
 * that exact markup there. Rewriting identical markup still replaces every
 * child node, and a drag selection anchored in a replaced node is dropped by
 * the browser, so live re-renders must leave unchanged blocks alone. Route
 * every write to an element through here; the comparison is against the
 * last markup written, not a serialization of the current DOM.
 */
export function setInnerHtmlIfChanged(element: Element, html: string): void {
  if (writtenMarkup.get(element) === html) return;
  element.innerHTML = html;
  writtenMarkup.set(element, html);
}
