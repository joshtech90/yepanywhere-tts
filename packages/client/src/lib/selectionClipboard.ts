import type { MarkdownSelectionSnippet } from "./markdownSelectionCopy";

const BLOCK_ELEMENTS = new Set([
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "P",
  "PRE",
  "TR",
]);

/** Copy the visible selection without reconstructing Markdown syntax. */
export function getSelectionPlainText(
  snippets: readonly MarkdownSelectionSnippet[],
): string {
  return snippets
    .map((snippet) => {
      // Highlighted source has exact offsets, including indentation/newlines.
      if (snippet.sourceStart !== undefined) return snippet.selectedText;
      return getVisibleSelectionText(snippet.range.cloneContents());
    })
    .join("\n\n");
}

/** Read a cloned selection, retaining structural line breaks and excluding UI. */
export function getVisibleSelectionText(fragment: ParentNode & Node): string {
  for (const ignored of fragment.querySelectorAll(
    '[data-markdown-copy-ignore="true"], .katex-html, annotation, script, style',
  ))
    ignored.remove();
  const text = (node: Node): { content: string; boundary: number } => {
    if (node.nodeType === Node.TEXT_NODE)
      return { content: node.textContent ?? "", boundary: 0 };
    const element = node instanceof Element ? node : null;
    if (element?.tagName === "BR") return { content: "\n", boundary: 0 };
    let content = "";
    let previousBoundary = 0;
    for (const child of node.childNodes) {
      const part = text(child);
      if (!part.content) continue;
      if (content) {
        const boundary = Math.max(previousBoundary, part.boundary);
        const existing =
          (content.match(/\n*$/)?.[0].length ?? 0) +
          (part.content.match(/^\n*/)?.[0].length ?? 0);
        content += "\n".repeat(Math.max(0, boundary - existing));
      }
      content += part.content;
      previousBoundary = part.boundary;
    }
    return {
      content,
      boundary:
        element && BLOCK_ELEMENTS.has(element.tagName)
          ? element.tagName === "P"
            ? 2
            : 1
          : 0,
    };
  };
  return text(fragment).content;
}
