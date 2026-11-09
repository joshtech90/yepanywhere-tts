import { expect, it, vi } from "vitest";
import { GeminiACPProvider } from "../../../src/sdk/providers/gemini-acp.js";

// Only the external CLI transport is replaced. The provider loop and
// cancellable MessageQueue are real, including the idle next() wait.
vi.mock("../../../src/sdk/providers/acp/client.js", () => ({
  ACPClient: class {
    // Settles only when the CLI process exits, which never happens here.
    closed = new Promise<void>(() => {});
    async connect() {}
    async initialize() {}
    async newSession() {
      return "idle-gemini-test";
    }
    async prompt() {}
    setSessionUpdateCallback() {}
    close() {}
  },
}));

it("finishes the provider iterator when an idle Gemini chat is archived", async () => {
  const provider = new GeminiACPProvider();
  const cli = provider as unknown as {
    findGeminiPath(): Promise<string>;
    checkACPSupport(path: string): Promise<boolean>;
  };
  vi.spyOn(cli, "findGeminiPath").mockResolvedValue("test-gemini");
  vi.spyOn(cli, "checkACPSupport").mockResolvedValue(true);
  const idle = await provider.startSession({
    cwd: "/tmp",
    initialMessage: { text: "hello" },
  });
  try {
    while (true) {
      const next = await idle.iterator.next();
      if (next.done) throw new Error("Provider ended before its first result");
      if (next.value.type === "result") break;
    }
    const waiting = idle.iterator.next();
    await Promise.resolve();
    idle.abort();
    expect((await waiting).done).toBe(true);
  } finally {
    idle.abort();
  }
});
