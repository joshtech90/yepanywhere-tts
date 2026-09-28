import { describe, expect, it } from "vitest";
import {
  createSessionsRoutes,
  type SessionsDeps,
} from "../../src/routes/sessions.js";
import type { ISessionReader } from "../../src/sessions/types.js";

describe("session detail before the provider transcript exists", () => {
  it("returns the latest snapshot per identity in first appearance order", async () => {
    const assistant = (uuid: string, text: string, streaming = true) => ({
      type: "assistant",
      uuid,
      _isStreaming: streaming,
      message: { role: "assistant", content: text },
    });
    const history = [
      assistant("commentary", "I’ll"),
      assistant("other-item", "Identical text", false),
      assistant("commentary", "I’ll open"),
      assistant("commentary", "I’ll open a Clair sketch.", false),
      assistant("distinct-item", "Identical text", false),
    ];
    const project = {
      id: "proj-1",
      path: "/tmp/project",
      name: "project",
      sessionDir: "/tmp/project/.claude-sessions",
      provider: "codex",
    };
    const routes = createSessionsRoutes({
      supervisor: {
        getProcessForSession: () => ({
          id: "proc-1",
          permissionMode: "default",
          appliedPermissionMode: "default",
          modeVersion: 0,
          startedAt: new Date(),
          state: { type: "in-turn" },
          provider: "codex",
          resolvedModel: "gpt-6-astra",
          supportsDynamicCommands: false,
          getMessageHistory: () => history,
          getDeferredQueueSummary: () => [],
          getProviderRuntimeStatus: () => null,
        }),
        wasEverOwned: () => true,
      } as unknown as SessionsDeps["supervisor"],
      scanner: {
        getOrCreateProject: async () => project,
      } as unknown as SessionsDeps["scanner"],
      readerFactory: () =>
        ({ getSession: async () => null }) as unknown as ISessionReader,
      sessionMetadataService: {
        getMetadata: () => undefined,
        getProvider: () => "codex",
        getRecapMessages: () => [],
      } as unknown as SessionsDeps["sessionMetadataService"],
    });
    const response = await routes.request("/projects/proj-1/sessions/sess-1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages).toMatchObject([
      {
        id: "commentary",
        message: { content: "I’ll open a Clair sketch." },
        _isStreaming: false,
      },
      { id: "other-item", message: { content: "Identical text" } },
      { id: "distinct-item", message: { content: "Identical text" } },
    ]);
    expect(body.session.messageCount).toBe(3);
    expect(history).toHaveLength(5);
  });
});
