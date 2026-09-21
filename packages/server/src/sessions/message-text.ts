/** Visible text of one normalized transcript message, with its source identity. */
export interface VisibleMessageText {
  id: string;
  role?: "user" | "assistant";
  sourceId?: string;
  text: string;
  timestamp?: string;
}

/** Accept only visible text blocks; tool output, reasoning and setup are never
 * part of a message's readable text, so no consumer can index or search them. */
export function visibleMessageText(message: {
  uuid?: string;
  id?: unknown;
  type: string;
  content?: unknown;
  message?: { content?: unknown };
  isMeta?: boolean;
  isSynthetic?: boolean;
  timestamp?: string;
}): VisibleMessageText | null {
  if (
    !["user", "assistant"].includes(message.type) ||
    message.isMeta ||
    message.isSynthetic
  )
    return null;
  const id =
    message.uuid ?? (typeof message.id === "string" ? message.id : undefined);
  if (!id) return null;
  const content = message.message?.content ?? message.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .flatMap((block) =>
              block && block.type === "text" && typeof block.text === "string"
                ? [block.text]
                : [],
            )
            .join("\n")
        : "";
  if (
    !text ||
    /^(?:# AGENTS\.md instructions|<environment_context>|<INSTRUCTIONS>)/.test(
      text.trim(),
    )
  )
    return null;
  return {
    id,
    text,
    timestamp: message.timestamp,
    role: message.type as "user" | "assistant",
  };
}
