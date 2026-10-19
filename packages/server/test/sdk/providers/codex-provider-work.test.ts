import { describe, expect, it, vi } from "vitest";
import { CodexProviderWorkTracker } from "../../../src/sdk/providers/codex-provider-work.js";

// Notification shapes are from 2026-10-15 app-server probes (codex-cli
// 0.160.0); see topics/provider-wait-and-background-work.evidence.md.
const THREAD = "thread-1";
const startedAtMs = Date.parse("2026-10-15T12:00:00.000Z");

function execStarted(id: string, command: string, threadId = THREAD) {
  return {
    method: "item/started",
    params: {
      threadId,
      turnId: "turn-1",
      startedAtMs,
      item: {
        type: "commandExecution",
        id,
        command: `/bin/zsh -lc '${command}'`,
        processId: "17260",
        source: "unifiedExecStartup",
        status: "inProgress",
        commandActions: [{ type: "unknown", command }],
      },
    },
  };
}

function itemCompleted(item: Record<string, unknown>) {
  return {
    method: "item/completed",
    params: { threadId: THREAD, turnId: "turn-1", item },
  };
}

const turnCompleted = {
  method: "turn/completed",
  params: { threadId: THREAD, turn: { id: "turn-1", status: "completed" } },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("CodexProviderWorkTracker", () => {
  it("keeps a dev server as background work across the turn end until it exits", async () => {
    const onChange = vi.fn();
    const list = vi.fn(async () => ({
      data: [
        {
          itemId: "exec-1",
          processId: "17260",
          command: "python3 -m http.server 8765",
        },
      ],
      nextCursor: null,
    }));
    const tracker = new CodexProviderWorkTracker(onChange, list);

    tracker.observe(
      execStarted("exec-1", "python3 -m http.server 8765"),
      THREAD,
    );
    // A short command in the same turn starts and finishes.
    tracker.observe(
      execStarted("exec-2", "curl -I http://localhost:8765/"),
      THREAD,
    );
    tracker.observe(
      itemCompleted({ type: "commandExecution", id: "exec-2", exitCode: 0 }),
      THREAD,
    );
    tracker.observe(turnCompleted, THREAD);
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());

    expect(tracker.getSnapshot()).toMatchObject({
      retained: false,
      reasons: [],
      foregroundWaits: [],
      backgroundWork: [
        {
          id: "exec-1",
          kind: "shell",
          label: "python3 -m http.server 8765",
          command: "/bin/zsh -lc 'python3 -m http.server 8765'",
          providerType: "unifiedExecStartup",
          startedAt: "2026-10-15T12:00:00.000Z",
          source: "codex:item/started",
        },
      ],
    });

    // The late completion arrives between turns, with the old turn id.
    onChange.mockClear();
    tracker.observe(
      itemCompleted({ type: "commandExecution", id: "exec-1", exitCode: 0 }),
      THREAD,
    );
    expect(tracker.getSnapshot().backgroundWork).toEqual([]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("reports an in-turn clock.sleep as a wait with its end time", () => {
    const tracker = new CodexProviderWorkTracker(vi.fn(), async () => null);
    tracker.observe(
      {
        method: "item/started",
        params: {
          threadId: THREAD,
          turnId: "turn-1",
          startedAtMs,
          item: { type: "sleep", id: "call_1", durationMs: 60_000 },
        },
      },
      THREAD,
    );
    expect(tracker.getSnapshot().foregroundWaits).toEqual([
      {
        id: "call_1",
        kind: "sleep",
        label: "clock.sleep",
        providerType: "clock.sleep",
        startedAt: "2026-10-15T12:00:00.000Z",
        until: "2026-10-15T12:01:00.000Z",
        source: "codex:item/started",
      },
    ]);
    tracker.observe(
      itemCompleted({ type: "sleep", id: "call_1", durationMs: 60_000 }),
      THREAD,
    );
    expect(tracker.getSnapshot().foregroundWaits).toEqual([]);
  });

  it("records a child agent as background work and wait_agent as a wait", () => {
    const tracker = new CodexProviderWorkTracker(vi.fn(), async () => null);
    const activity = (kind: string, id: string) => ({
      method: "item/started",
      params: {
        threadId: THREAD,
        turnId: "turn-1",
        startedAtMs,
        item: {
          type: "subAgentActivity",
          id,
          kind,
          agentThreadId: "child-1",
          agentPath: "/root/time_after_minute",
        },
      },
    });
    const wait = {
      type: "collabAgentToolCall",
      id: "call_wait",
      tool: "wait",
      status: "inProgress",
      senderThreadId: THREAD,
      receiverThreadIds: ["child-1"],
    };

    tracker.observe(activity("started", "call_spawn"), THREAD);
    tracker.observe(
      {
        method: "item/started",
        params: { threadId: THREAD, turnId: "turn-1", startedAtMs, item: wait },
      },
      THREAD,
    );
    expect(tracker.getSnapshot()).toMatchObject({
      backgroundWork: [
        {
          id: "child-1",
          kind: "subagent",
          label: "/root/time_after_minute",
          source: "codex:subAgentActivity",
        },
      ],
      foregroundWaits: [
        { id: "call_wait", kind: "subagent", label: "wait_agent" },
      ],
    });

    tracker.observe(itemCompleted({ ...wait, status: "completed" }), THREAD);
    tracker.observe(activity("completed", "subagent-completed-1"), THREAD);
    expect(tracker.getSnapshot()).toMatchObject({
      backgroundWork: [],
      foregroundWaits: [],
    });
  });

  it("ignores items from subagent threads", () => {
    const tracker = new CodexProviderWorkTracker(vi.fn(), async () => null);
    tracker.observe(execStarted("exec-9", "sleep 120", "child-thread"), THREAD);
    expect(tracker.getSnapshot().backgroundWork).toEqual([]);
  });

  it("reconciles with the terminal list without resurrecting items that ended meanwhile", async () => {
    const response = deferred<unknown>();
    const list = vi.fn(() => response.promise);
    const tracker = new CodexProviderWorkTracker(vi.fn(), list);

    tracker.observe(execStarted("exec-gone", "sleep 5"), THREAD);
    tracker.observe(execStarted("exec-late", "sleep 300"), THREAD);
    tracker.observe(turnCompleted, THREAD);
    expect(list).toHaveBeenCalledOnce();

    // While the request is in flight one listed process exits.
    tracker.observe(
      itemCompleted({ type: "commandExecution", id: "exec-late" }),
      THREAD,
    );
    response.resolve({
      data: [
        { itemId: "exec-late", command: "sleep 300" },
        { itemId: "exec-missed", command: "npm run dev" },
      ],
      nextCursor: null,
    });
    await vi.waitFor(() =>
      expect(
        tracker.getSnapshot().backgroundWork?.map((item) => item.id),
      ).toEqual(["exec-missed"]),
    );
    expect(tracker.getSnapshot().backgroundWork?.[0]).toMatchObject({
      label: "npm run dev",
      source: "codex:thread/backgroundTerminals/list",
    });
  });

  it("forgets everything when the app-server is replaced", () => {
    const onChange = vi.fn();
    const tracker = new CodexProviderWorkTracker(onChange, async () => null);
    tracker.observe(execStarted("exec-1", "npm run dev"), THREAD);
    onChange.mockClear();
    tracker.reset();
    expect(tracker.getSnapshot().backgroundWork).toEqual([]);
    expect(onChange).toHaveBeenCalledOnce();
  });
});
