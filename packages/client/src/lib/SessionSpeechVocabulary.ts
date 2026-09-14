import {
  MAX_SPEECH_SESSION_TERMS,
  speechVocabularyTokens,
} from "@yep-anywhere/shared";
import type { Message } from "../types";

/** View-owned vocabulary: no transcript reads, history window, or idle timer. */
export class SessionSpeechVocabulary {
  private active = false;
  private readonly words = new Set<string>();
  private readonly asrIntroductions = new Set<string>();
  private readonly seen = new WeakSet<Message>();

  observe(messages: readonly Message[]): void {
    if (!this.active) return;
    for (const message of messages) {
      if (this.seen.has(message) || message._isStreaming) continue;
      this.seen.add(message);
      const role = message.type ?? message.role;
      if (
        (role !== "user" && role !== "assistant") ||
        message.isMeta ||
        message.isCompactSummary ||
        message.isSubagent
      )
        continue;
      const content = message.message?.content ?? message.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter(
                  (block) =>
                    block.type === "text" && typeof block.text === "string",
                )
                .map((block) => block.text)
                .join("\n")
            : "";
      const metadata = message.messageMetadata;
      const asr =
        role === "user" &&
        typeof metadata === "object" &&
        metadata !== null &&
        "speech" in metadata &&
        metadata.speech !== undefined;
      if (asr) this.heard(text);
      else
        for (const word of speechVocabularyTokens(text)) {
          // Assistant reuse establishes relevance even after an ASR introduction.
          if (role === "assistant") this.asrIntroductions.delete(word);
          if (word.length <= 50 && !this.asrIntroductions.has(word))
            this.words.add(word);
        }
    }
  }

  heard(text: string): void {
    if (!this.active) return;
    for (const word of speechVocabularyTokens(text)) {
      if (word.length <= 50 && !this.words.has(word))
        this.asrIntroductions.add(word);
    }
  }

  terms(messages: readonly Message[]): string[] {
    this.active = true;
    this.observe(messages);
    // Retain the whole set locally; only the request has a transport ceiling.
    return [...this.words].slice(-MAX_SPEECH_SESSION_TERMS);
  }
}
