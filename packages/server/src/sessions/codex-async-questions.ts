import { open, stat } from "node:fs/promises";
import type { AppSessionSummary } from "@yep-anywhere/shared";
import { parseCodexSessionEntry } from "@yep-anywhere/shared";
import { SourceVersionedSingleFlight } from "../lib/sourceVersionedSingleFlight.js";
import { isCompressedCodexRolloutPath } from "../utils/codexRolloutFiles.js";
import { isCodexUserMessageEventEntry } from "./codex-user-turn-provenance.js";
import { getCodexAsyncAgentMessageItem } from "./normalization.js";
import { readCodexSessionMeta } from "./codex-rollout-lineage.js";

type QuestionSummary = NonNullable<AppSessionSummary["asyncQuestions"]>;
export const CODEX_QUESTION_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_QUESTIONS = 128;
const MAX_TURN_AGE = 32;
const previews = new SourceVersionedSingleFlight<string, QuestionSummary>({
  maxRetainedBytes: 8 * 1024 * 1024,
  estimateBytes: (value) => 256 + JSON.stringify(value).length * 2,
});

function version(stats: Awaited<ReturnType<typeof stat>>): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}

export async function readCodexAsyncQuestions(
  filePath: string,
): Promise<QuestionSummary | undefined> {
  if (isCompressedCodexRolloutPath(filePath)) return undefined;
  const stats = await stat(filePath);
  const result = await previews.run({
    key: filePath,
    sourceVersion: version(stats),
    isCurrent: async (sourceVersion) =>
      version(await stat(filePath)) === sourceVersion,
    compute: async () => {
      const meta = await readCodexSessionMeta(filePath);
      const start = Math.max(
        0,
        Number(stats.size) - CODEX_QUESTION_PREVIEW_BYTES,
      );
      const file = await open(filePath, "r");
      let text: string;
      try {
        const buffer = Buffer.alloc(Number(stats.size) - start);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await file.read(
            buffer,
            offset,
            buffer.length - offset,
            start + offset,
          );
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        text = buffer.subarray(0, offset).toString("utf8");
      } finally {
        await file.close();
      }
      const lines = text.split("\n");
      if (start > 0) lines.shift();
      const questions: QuestionSummary["questions"] = [];
      const seen = new Set<string>();
      let age = 0;
      let omitted = start > 0 || Boolean(meta.payload.history_base);
      for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex--) {
        const line = lines[lineIndex]!;
        if (
          !line.includes('"item_completed"') &&
          !line.includes('"user_message"')
        )
          continue;
        const entry = parseCodexSessionEntry(line);
        if (!entry) continue;
        if (isCodexUserMessageEventEntry(entry)) {
          age += 1;
          if (age >= MAX_TURN_AGE) {
            omitted = false;
            break;
          }
        }
        const message = getCodexAsyncAgentMessageItem(entry);
        if (!message?.questions || seen.has(message.id)) continue;
        seen.add(message.id);
        for (let index = message.questions.length - 1; index >= 0; index--) {
          const question = message.questions[index]!;
          questions.push({
            messageId: message.id,
            index,
            title: question.title.slice(0, 320),
            age,
          });
          if (questions.length === MAX_QUESTIONS) break;
        }
        if (questions.length === MAX_QUESTIONS) {
          omitted = true;
          break;
        }
      }
      return { questions: questions.reverse(), omitted };
    },
  });
  return result.status === "stale" ? undefined : result.value;
}
