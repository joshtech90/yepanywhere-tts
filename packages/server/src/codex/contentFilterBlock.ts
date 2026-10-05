/**
 * Codex (0.160+) answers a response blocked by the content filter by recording
 * a developer message telling the model how to recover before it retries. The
 * message is the only durable trace of the block, so YA shows it as a system
 * row carrying the guidance text, for live and persisted events alike.
 */

const OPEN_MARKER = "<content_filter_guidance>";
const CLOSE_MARKER = "</content_filter_guidance>";

export const CODEX_CONTENT_FILTER_BLOCK_SUBTYPE = "content_filter_block";

/** The guidance text of a Codex content-filter developer message, else null. */
export function codexContentFilterGuidance(payload: {
  role?: unknown;
  content?: unknown;
}): string | null {
  if (payload.role !== "developer" || !Array.isArray(payload.content)) {
    return null;
  }
  const text = payload.content
    .map((block: { type?: unknown; text?: unknown }) =>
      block?.type === "input_text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("")
    .trim();
  if (!text.startsWith(OPEN_MARKER) || !text.endsWith(CLOSE_MARKER)) {
    return null;
  }
  return text.slice(OPEN_MARKER.length, -CLOSE_MARKER.length).trim();
}
