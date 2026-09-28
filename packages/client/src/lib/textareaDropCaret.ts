/** Hit-test native textarea text through a temporary, identically styled mirror.
 * Native textareas do not expose DOM ranges for their rendered text. */
export function textareaDropCaret(
  textarea: HTMLTextAreaElement,
  x: number,
  y: number,
): { offset: number; x: number; y: number; height: number } | null {
  const bounds = textarea.getBoundingClientRect();
  if (
    textarea.disabled ||
    textarea.readOnly ||
    x < bounds.left ||
    x > bounds.right ||
    y < bounds.top ||
    y > bounds.bottom
  )
    return null;
  const mirror = document.createElement("div");
  const computed = getComputedStyle(textarea);
  for (const property of [
    "font",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-align",
    "text-indent",
    "text-transform",
    "direction",
    "tab-size",
    "padding",
    "border",
    "box-sizing",
  ]) {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  }
  Object.assign(mirror.style, {
    position: "fixed",
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    whiteSpace: textarea.wrap === "off" ? "pre" : "pre-wrap",
    overflowWrap: "break-word",
    overflow: "auto",
    opacity: "0",
    zIndex: "2147483647",
    pointerEvents: "auto",
  });
  mirror.textContent = `${textarea.value}\u200b`;
  document.body.append(mirror);
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
  try {
    const caretDocument = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    let range: Range | null = null;
    if (caretDocument.caretPositionFromPoint) {
      const position = caretDocument.caretPositionFromPoint(x, y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    } else {
      range = caretDocument.caretRangeFromPoint?.(x, y) ?? null;
    }
    if (!range || !mirror.contains(range.startContainer)) return null;
    const prefix = document.createRange();
    prefix.selectNodeContents(mirror);
    prefix.setEnd(range.startContainer, range.startOffset);
    const offset = Math.min(prefix.toString().length, textarea.value.length);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    range.insertNode(marker);
    const rect = marker.getBoundingClientRect();
    return { offset, x: rect.left, y: rect.top, height: rect.height };
  } finally {
    mirror.remove();
  }
}
