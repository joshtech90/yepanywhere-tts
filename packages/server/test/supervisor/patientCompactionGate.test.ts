import { describe, expect, it, vi } from "vitest";
import { MessageQueue } from "../../src/sdk/messageQueue.js";
import type { AgentProvider } from "../../src/sdk/providers/types.js";
import { Supervisor } from "../../src/supervisor/Supervisor.js";
import type { SessionSummary } from "../../src/supervisor/types.js";

/**
 * Compact-first delivery for patient topic shifts
 * (topics/patient-topic-shift.md): usage is read when the item reaches its
 * delivery boundary, compaction runs before it, and the item delivers once.
 */
const SESSION_ID = "patient-compaction-gate-session";
const SETTINGS = {
  model: "claude-opus-5",
  providerName: "claude" as const,
  compactAtContextWindow: 200_000,
};
const TOPIC = "next topic";

function createHarness(options: {
  inputTokens: number | undefined;
  compactFails?: boolean;
  /** Non-Claude providers deliver patient items at the ordinary turn end. */
  providerName?: "claude" | "codex";
}) {
  const providerName = options.providerName ?? "claude";
  const delivered: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const startSession = vi.fn(async () => {
    const queue = new MessageQueue();
    let aborted = false;

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
          yield options.compactFails
            ? {
                type: "system" as const,
                subtype: "status" as const,
                compact_result: "failed",
                compact_error: "context too large to summarize",
                session_id: SESSION_ID,
              }
            : {
                type: "system" as const,
                subtype: "compact_boundary" as const,
                session_id: SESSION_ID,
              };
          yield { type: "result" as const, session_id: SESSION_ID };
          continue;
        }
        if (text === "first") await firstReleased;
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
    name: providerName,
    displayName: providerName,
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
  const supervisor = new Supervisor({
    provider,
    idleTimeoutMs: 60_000,
    onSessionSummary: vi.fn(
      async () =>
        ({
          contextUsage:
            options.inputTokens === undefined
              ? undefined
              : { inputTokens: options.inputTokens, percentage: 0 },
        }) as SessionSummary,
    ),
  });
  return {
    supervisor,
    delivered,
    releaseFirst,
    settings: { ...SETTINGS, providerName },
  };
}

async function startWithQueuedTopic(harness: ReturnType<typeof createHarness>) {
  const started = await harness.supervisor.resumeSession(
    SESSION_ID,
    "/tmp/test",
    { text: "first" },
    undefined,
    harness.settings,
  );
  if (!("id" in started)) throw new Error("expected process");
  const process = harness.supervisor.getProcessForSession(SESSION_ID);
  if (!process) throw new Error("expected live process");
  await vi.waitFor(() => expect(process.state.type).toBe("in-turn"));
  process.deferMessage({
    text: TOPIC,
    tempId: "topic-1",
    metadata: {
      deliveryIntent: "patient",
      patienceSeconds: 0,
      patientSource: "topic-shift",
      compactAboveContextPercent: 50,
    },
  });
  harness.releaseFirst();
  return { processId: started.id, process };
}

describe("patient compact-first delivery", () => {
  it("compacts above the threshold, then delivers the topic once", async () => {
    const harness = createHarness({ inputTokens: 150_000 });
    const { processId } = await startWithQueuedTopic(harness);

    await vi.waitFor(() => expect(harness.delivered).toContain(TOPIC));
    expect(harness.delivered).toEqual(["first", "/compact", TOPIC]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(harness.delivered.filter((text) => text === TOPIC)).toHaveLength(1);
    await harness.supervisor.abortProcess(processId);
  });

  it("holds a turn-end delivery for compaction on other providers", async () => {
    const harness = createHarness({
      inputTokens: 150_000,
      providerName: "codex",
    });
    const { processId } = await startWithQueuedTopic(harness);

    await vi.waitFor(() => expect(harness.delivered).toContain(TOPIC));
    expect(harness.delivered).toEqual(["first", "/compact", TOPIC]);
    await harness.supervisor.abortProcess(processId);
  });

  it("delivers without compacting below the threshold", async () => {
    const harness = createHarness({ inputTokens: 40_000 });
    const { processId } = await startWithQueuedTopic(harness);

    await vi.waitFor(() => expect(harness.delivered).toContain(TOPIC));
    expect(harness.delivered).toEqual(["first", TOPIC]);
    await harness.supervisor.abortProcess(processId);
  });

  it("never treats unknown usage as above the threshold", async () => {
    const harness = createHarness({ inputTokens: undefined });
    const { processId } = await startWithQueuedTopic(harness);

    await vi.waitFor(() => expect(harness.delivered).toContain(TOPIC));
    expect(harness.delivered).toEqual(["first", TOPIC]);
    await harness.supervisor.abortProcess(processId);
  });

  it("holds a failed item visibly until sent without compacting", async () => {
    const harness = createHarness({ inputTokens: 150_000, compactFails: true });
    const { processId, process } = await startWithQueuedTopic(harness);

    await vi.waitFor(() =>
      expect(process.getDeferredQueueSummary()[0]?.compactionGate).toEqual({
        state: "failed",
        reason: "context too large to summarize",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(harness.delivered).toEqual(["first", "/compact"]);

    expect(
      harness.supervisor.deliverPatientWithoutCompaction(process, "topic-1"),
    ).toBe(true);
    await vi.waitFor(() => expect(harness.delivered).toContain(TOPIC));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(harness.delivered).toEqual(["first", "/compact", TOPIC]);
    await harness.supervisor.abortProcess(processId);
  });
});
