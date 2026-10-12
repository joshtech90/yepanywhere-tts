import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeProvider } from "../../../src/sdk/providers/claude.js";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", async (original) => ({
  ...(await original<object>()),
  query,
}));

describe("Claude session ids", () => {
  afterEach(() => {
    query.mockReset();
  });

  async function launchOptions(
    options: Pick<
      Parameters<ClaudeProvider["startSession"]>[0],
      "newSessionId" | "resumeSessionId"
    >,
  ): Promise<Record<string, unknown>> {
    let launched: Record<string, unknown> = {};
    query.mockImplementation(({ options: queryOptions }) =>
      (async function* () {
        launched = queryOptions;
        yield { type: "result", session_id: "sess", subtype: "success" };
      })(),
    );
    const session = await new ClaudeProvider().startSession({
      cwd: process.cwd(),
      ...options,
    });
    try {
      for await (const _message of session.iterator) {
        // drain the single result
      }
    } finally {
      await session.abort();
    }
    return launched;
  }

  it("starts a new session under the caller's id", async () => {
    const options = await launchOptions({ newSessionId: "ya-minted-id" });
    expect(options).toMatchObject({ sessionId: "ya-minted-id" });
    expect(options.resume).toBeUndefined();
  });

  it("never combines a caller id with resume", async () => {
    const options = await launchOptions({
      newSessionId: "ya-minted-id",
      resumeSessionId: "existing-id",
    });
    expect(options).toMatchObject({ resume: "existing-id" });
    expect(options.sessionId).toBeUndefined();
  });
});
