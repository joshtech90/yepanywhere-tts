// Loaded only by the reviewer image. Keep the production mock and SDK unchanged.
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { MockRealClaudeSDK } from "./dist/sdk/mock.js";
import { MessageQueue } from "./dist/sdk/messageQueue.js";

if (process.env.USE_MOCK_SDK !== "true") {
  throw new Error("Reviewer provider requires the explicit mock SDK setting");
}

MockRealClaudeSDK.prototype.startSession = async (options) => {
  const sessionId = options.resumeSessionId ?? randomUUID();
  if (!/^[\da-f-]{36}$/i.test(sessionId)) {
    throw new Error("Reviewer sessions must use UUID identities");
  }
  const transcript = join(
    process.env.HOME,
    ".claude/projects",
    hostname(),
    options.cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    `${sessionId}.jsonl`,
  );
  await mkdir(dirname(transcript), { recursive: true });
  let parentUuid = null;
  const existing = await readFile(transcript, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  if (existing.trim()) {
    parentUuid = JSON.parse(existing.trim().split("\n").at(-1)).uuid;
  }
  const queue = new MessageQueue();
  const input = queue[Symbol.asyncIterator]();
  let running = true;

  async function* messages() {
    yield { type: "system", subtype: "init", session_id: sessionId };
    if (options.initialMessage) queue.push(options.initialMessage);
    while (running) {
      const next = await input.next();
      if (next.done || !running) break;
      const user = {
        type: "user",
        uuid: next.value.uuid ?? randomUUID(),
        parentUuid,
        sessionId,
        session_id: sessionId,
        cwd: options.cwd,
        timestamp: new Date().toISOString(),
        message: next.value.message,
      };
      const assistant = {
        ...user,
        type: "assistant",
        uuid: randomUUID(),
        parentUuid: user.uuid,
        message: {
          role: "assistant",
          model: "mock-model",
          content: [
            {
              type: "text",
              text: "This is a mock response from the reviewer demo. You can browse the sample files, create sessions, and send more messages. No AI service was called and no commands were executed.",
            },
          ],
        },
      };
      await appendFile(
        transcript,
        `${JSON.stringify(user)}\n${JSON.stringify(assistant)}\n`,
      );
      parentUuid = assistant.uuid;
      yield user;
      yield assistant;
      yield {
        type: "result",
        subtype: "success",
        session_id: sessionId,
        total_cost_usd: 0,
      };
    }
  }

  return {
    iterator: messages(),
    queue,
    abort: async () => {
      running = false;
      await input.return();
    },
    isProcessAlive: () => running,
  };
};
