import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it } from "vitest";
import { PiProvider } from "../../src/sdk/providers/pi.js";
import type { SDKMessage } from "../../src/sdk/types.js";
import { PiSessionReader } from "../../src/sessions/pi-reader.js";

/**
 * Runs the installed pi against a local OpenAI-compatible server that refuses
 * one reasoning effort, the way vLLM does, so the retry path is exercised end
 * to end: YA's extension loading, the set-aside command, and what pi's session
 * file then holds. Opt-in like the pi contract test, since it needs pi.
 */
const describePi =
  process.env.PI_CONTRACT_TEST === "true" ? describe : describe.skip;
const TEST_TIMEOUT_MS = process.platform === "win32" ? 180_000 : 60_000;
const REFUSAL =
  "Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.";

interface ChatRequest {
  reasoning_effort?: string;
  messages?: { role: string; content: unknown }[];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
}

function sseChunk(delta: object, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "m1",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/** A chat-completions endpoint that refuses effort "high" and answers otherwise. */
async function startRefusingServer(): Promise<{
  server: Server;
  baseUrl: string;
  requests: ChatRequest[];
}> {
  const requests: ChatRequest[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const request = JSON.parse(body || "{}") as ChatRequest;
      requests.push(request);
      if (request.reasoning_effort === "high") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: REFUSAL } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseChunk({ role: "assistant", content: "pong" }, null));
      res.write(sseChunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}/v1`, requests };
}

describePi("pi turn refused over its thinking level", () => {
  let cleanup: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const step of cleanup.reverse()) await step();
    cleanup = [];
  });

  it(
    "retries lower with the prompt held once, in context and in the session file",
    async () => {
      const { server, baseUrl, requests } = await startRefusingServer();
      cleanup.push(
        () => new Promise<void>((resolve) => server.close(() => resolve())),
      );
      const root = await mkdtemp(join(tmpdir(), "ya-pi-effort-retry-"));
      cleanup.push(() => rm(root, { recursive: true, force: true }));
      const agentDir = join(root, "agent");
      const project = join(root, "project");
      await mkdir(agentDir, { recursive: true });
      await mkdir(project, { recursive: true });
      await writeFile(
        join(agentDir, "models.json"),
        JSON.stringify({
          providers: {
            fake: {
              baseUrl,
              api: "openai-completions",
              apiKey: "unused",
              models: [{ id: "m1", reasoning: true }],
            },
          },
        }),
      );

      const provider = new PiProvider({
        sessionsDir: join(agentDir, "sessions"),
      });
      const session = await provider.startSession({
        cwd: project,
        model: "fake/m1",
        effort: "high",
        remoteEnv: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
        initialMessage: { text: "ping" },
      });
      cleanup.push(async () => session.abort());

      const streamed: SDKMessage[] = [];
      for await (const message of session.iterator) {
        streamed.push(message);
        if (message.type === "result") break;
      }

      const result = streamed.at(-1) as SDKMessage & { error?: string };
      expect(result.type).toBe("result");
      expect(result.error).toBeUndefined();
      expect(
        streamed.some(
          (m) =>
            m.type === "assistant" &&
            String(m.message?.content).includes("retried at **medium**"),
        ),
      ).toBe(true);

      expect(requests.map((r) => r.reasoning_effort)).toEqual([
        "high",
        "medium",
      ]);
      const retriedPrompts = (requests[1]?.messages ?? []).filter(
        (m) => m.role === "user",
      );
      expect(retriedPrompts.map((m) => textOf(m.content))).toEqual(["ping"]);

      const reader = new PiSessionReader({
        sessionsDir: join(agentDir, "sessions"),
      });
      const loaded = await reader.getSession(
        session.sessionId ?? "",
        "p" as UrlProjectId,
      );
      const persisted =
        loaded?.data.provider === "pi" ? loaded.data.session.messages : [];
      expect(
        persisted.map((m) =>
          m.type === "user"
            ? `user:${String(m.message?.content)}`
            : `assistant:${JSON.stringify(m.message?.content)}`,
        ),
      ).toEqual([
        "user:ping",
        expect.stringContaining("retried at **medium**"),
        'assistant:[{"type":"text","text":"pong"}]',
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});
