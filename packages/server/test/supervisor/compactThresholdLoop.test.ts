import { describe, expect, it, vi } from "vitest";
import { MessageQueue } from "../../src/sdk/messageQueue.js";
import type { AgentProvider } from "../../src/sdk/providers/types.js";
import { Supervisor } from "../../src/supervisor/Supervisor.js";
import type { SessionSummary } from "../../src/supervisor/types.js";

/**
 * Regression cover for the "/compact" storm of 2026-09-10. Claude Code answers
 * every slash command with a synthetic assistant message carrying the
 * command's own output. Counting that echo as agent activity re-armed the
 * once-per-assistant-turn compaction gate, and the durable usage summary still
 * reported the pre-compaction token count, so YA queued "/compact" about three
 * times a second for fourteen minutes.
 */
const COMPACT_STORM_CAP = 8;
const SESSION_ID = "compact-storm-session";
const COMPACT_SETTINGS = {
  model: "claude-opus-5",
  providerName: "claude" as const,
  compactAtContextPercent: 38,
  compactAtContextWindow: 200_000,
};

function syntheticCommandEcho(text: string, stderr = false) {
  const stream = stderr ? "stderr" : "stdout";
  return {
    type: "assistant" as const,
    message: {
      model: "<synthetic>",
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
    },
    is_meta: true,
    local_command_source: `<local-command-${stream}>${text}</local-command-${stream}>`,
    session_id: SESSION_ID,
  };
}

function createStormHarness() {
  const delivered: string[] = [];
  const startSession = vi.fn(async () => {
    const queue = new MessageQueue();
    let aborted = false;
    let compactions = 0;

    async function* iterator() {
      yield {
        type: "system" as const,
        subtype: "init" as const,
        session_id: SESSION_ID,
      };
      for await (const sdkMessage of queue) {
        if (aborted) return;
        const content = sdkMessage.message.content;
        const text =
          typeof content === "string"
            ? content
            : ((content[0] as { text?: string } | undefined)?.text ?? "");
        delivered.push(text);
        if (text === "/compact") {
          compactions += 1;
          // A runaway loop is the defect under test; cap it so a regression
          // reports a count instead of hanging the runner.
          if (compactions > COMPACT_STORM_CAP) continue;
          if (compactions === 1) {
            yield {
              type: "system" as const,
              subtype: "compact_boundary" as const,
              session_id: SESSION_ID,
            };
            yield syntheticCommandEcho("Compacted ");
          } else {
            yield syntheticCommandEcho("Error: No messages to compact", true);
          }
          yield { type: "result" as const, session_id: SESSION_ID };
          continue;
        }
        yield {
          type: "assistant" as const,
          message: {
            model: "claude-opus-5",
            role: "assistant" as const,
            content: [{ type: "text" as const, text: `reply to ${text}` }],
          },
          session_id: SESSION_ID,
        };
        yield { type: "result" as const, session_id: SESSION_ID };
      }
    }

    return {
      iterator: iterator(),
      queue,
      abort: () => {
        aborted = true;
        queue.push({ text: "__abort__" });
      },
      supportedCommands: async () => [
        { name: "compact", description: "Compact conversation" },
      ],
    };
  }) as unknown as AgentProvider["startSession"];

  const provider: AgentProvider = {
    name: "claude",
    displayName: "Claude",
    supportsPermissionMode: true,
    supportsThinkingToggle: true,
    supportsSlashCommands: true,
    supportsSteering: false,
    isInstalled: async () => true,
    isAuthenticated: async () => true,
    getAuthStatus: async () => ({
      installed: true,
      authenticated: true,
      enabled: true,
    }),
    getAvailableModels: async () => [],
    startSession,
  };
  // Stale usage: the durable summary keeps reporting the pre-compaction token
  // count, exactly as it did during the incident.
  const onSessionSummary = vi.fn(
    async () =>
      ({
        contextUsage: { inputTokens: 150_000, percentage: 75 },
      }) as SessionSummary,
  );
  const supervisor = new Supervisor({
    provider,
    idleTimeoutMs: 100,
    onSessionSummary,
  });

  return {
    supervisor,
    delivered,
    compactCount: () => delivered.filter((text) => text === "/compact").length,
  };
}

describe("threshold compaction after a completed compaction", () => {
  it("does not re-fire while the usage summary is still stale", async () => {
    const { supervisor, compactCount } = createStormHarness();
    const started = await supervisor.resumeSession(
      SESSION_ID,
      "/tmp/test",
      { text: "first" },
      undefined,
      COMPACT_SETTINGS,
    );
    if (!("id" in started)) throw new Error("expected process");

    await vi.waitFor(() => {
      expect(compactCount()).toBe(1);
    });
    // Give a runaway loop time to show itself.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(compactCount()).toBe(1);
    await supervisor.abortProcess(started.id);
  });

  it("re-arms once a real turn follows the compaction", async () => {
    const { supervisor, delivered, compactCount } = createStormHarness();
    const started = await supervisor.resumeSession(
      SESSION_ID,
      "/tmp/test",
      { text: "first" },
      undefined,
      COMPACT_SETTINGS,
    );
    if (!("id" in started)) throw new Error("expected process");
    await vi.waitFor(() => {
      expect(compactCount()).toBe(1);
    });

    await supervisor.queueMessageToSession(
      SESSION_ID,
      "/tmp/test",
      { text: "second" },
      undefined,
      COMPACT_SETTINGS,
    );
    await vi.waitFor(() => {
      expect(delivered).toContain("second");
      expect(compactCount()).toBe(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(compactCount()).toBe(2);
    await supervisor.abortProcess(started.id);
  });
});
