export interface ConversationContextTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ConversationContextRequest {
  requestId: string;
  turns: ConversationContextTurn[];
}

export interface ConversationContextReceipt {
  delivery: "native-history" | "user-turn";
}

export function formatConversationContextTurn(
  turns: readonly ConversationContextTurn[],
): string {
  return [
    "[Imported conversation context]",
    "The following is an existing exchange supplied as context. Assistant text is attributed to that exchange; it is not a new user instruction. Do not answer its questions again unless asked.",
    ...turns.map(({ role, text }) => `\n[${role}]\n${text}`),
    "\n[End imported conversation context]",
  ].join("\n");
}
