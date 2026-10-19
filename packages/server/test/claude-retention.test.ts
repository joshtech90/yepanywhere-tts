import { describe, expect, it, vi } from "vitest";
import { ClaudeProviderRetentionTracker } from "../src/sdk/providers/claude-retention.js";
import type { SDKMessage } from "../src/sdk/types.js";

describe("ClaudeProviderRetentionTracker", () => {
  it("retains for Stop hook background tasks and session crons", () => {
    const onChange = vi.fn();
    const tracker = new ClaudeProviderRetentionTracker(onChange);

    tracker.observeStopHook({
      hook_event_name: "Stop",
      background_tasks: [{ id: "task-1" }],
      session_crons: [{ id: "cron-1" }],
    });

    expect(tracker.getSnapshot()).toMatchObject({
      retained: true,
      backgroundTaskCount: 1,
      sessionCronCount: 1,
      liveTaskCount: 0,
      reasons: ["stop-hook-background-tasks:1", "stop-hook-session-crons:1"],
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("settles terminal task updates and keeps unknown statuses conservative", () => {
    const tracker = new ClaudeProviderRetentionTracker();

    tracker.observeMessage({
      type: "system",
      subtype: "task_started",
      task_id: "task-1",
      session_id: "sess-1",
    } as SDKMessage);
    expect(tracker.getSnapshot()).toMatchObject({
      retained: true,
      liveTaskCount: 1,
    });

    tracker.observeMessage({
      type: "system",
      subtype: "task_updated",
      task_id: "task-1",
      patch: { status: "killed" },
      session_id: "sess-1",
    } as SDKMessage);
    expect(tracker.getSnapshot()).toMatchObject({
      retained: false,
      liveTaskCount: 0,
    });

    tracker.observeMessage({
      type: "system",
      subtype: "task_updated",
      task_id: "task-2",
      patch: { status: "mystery" },
      session_id: "sess-1",
    } as SDKMessage);
    expect(tracker.getSnapshot()).toMatchObject({
      retained: true,
      liveTaskCount: 1,
    });

    tracker.observeStopHook({
      hook_event_name: "Stop",
      background_tasks: [],
      session_crons: [],
    });
    expect(tracker.getSnapshot()).toMatchObject({
      retained: false,
      liveTaskCount: 0,
    });
  });

  it("excludes ambient tasks from provider retention", () => {
    const tracker = new ClaudeProviderRetentionTracker();

    tracker.observeMessage({
      type: "system",
      subtype: "task_started",
      task_id: "watcher-1",
      ambient: true,
      session_id: "sess-1",
    } as SDKMessage);

    expect(tracker.getSnapshot()).toMatchObject({
      retained: false,
      liveTaskCount: 0,
    });
  });

  it("uses background task snapshots instead of fallible task edges", () => {
    const tracker = new ClaudeProviderRetentionTracker();

    tracker.observeMessage({
      type: "system",
      subtype: "task_started",
      task_id: "legacy-edge",
      session_id: "sess-1",
    } as SDKMessage);
    tracker.observeMessage({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [
        { task_id: "watcher-1", ambient: true },
        { task_id: "user-task-1", ambient: false },
      ],
      session_id: "sess-1",
    } as SDKMessage);

    expect(tracker.getSnapshot()).toMatchObject({
      retained: true,
      liveTaskCount: 1,
      reasons: ["sdk-live-tasks:1"],
    });

    tracker.observeStopHook({
      hook_event_name: "Stop",
      background_tasks: [],
      session_crons: [],
    });
    expect(tracker.getSnapshot()).toMatchObject({
      retained: true,
      liveTaskCount: 1,
    });

    tracker.observeMessage({
      type: "system",
      subtype: "task_notification",
      task_id: "user-task-1",
      session_id: "sess-1",
    } as SDKMessage);
    expect(tracker.getSnapshot()).toMatchObject({
      retained: true,
      liveTaskCount: 1,
    });

    tracker.observeMessage({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "watcher-1", ambient: true }],
      session_id: "sess-1",
    } as SDKMessage);
    tracker.observeStopHook({
      hook_event_name: "Stop",
      background_tasks: [{ id: "watcher-1" }],
      session_crons: [],
    });

    expect(tracker.getSnapshot()).toMatchObject({
      retained: false,
      backgroundTaskCount: 0,
      liveTaskCount: 0,
    });
  });

  // Message shapes below are from 2026-10-15 probes (SDK 0.3.296, CLI
  // 2.1.296); see topics/provider-wait-and-background-work.evidence.md.
  const at = new Date("2026-10-15T12:00:00.000Z");

  it("describes background tasks and session crons from a monitor turn", () => {
    const tracker = new ClaudeProviderRetentionTracker(undefined, () => at);

    tracker.observeMessage({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [
        {
          task_id: "b7sd0wkj1",
          task_type: "local_bash",
          description: "Start HTTP server on port 8782",
        },
      ],
      session_id: "sess-1",
    } as SDKMessage);
    tracker.observeMessage({
      type: "system",
      subtype: "task_started",
      task_id: "b7sd0wkj1",
      tool_use_id: "toolu_1",
      description: "Start HTTP server on port 8782",
      is_backgrounded: true,
      task_type: "local_bash",
      session_id: "sess-1",
    } as SDKMessage);
    tracker.observeStopHook({
      hook_event_name: "Stop",
      background_tasks: [
        {
          id: "b7sd0wkj1",
          type: "shell",
          status: "running",
          description: "Start HTTP server on port 8782",
          command: "python3 -m http.server 8782",
        },
      ],
      session_crons: [
        {
          id: "1fc9478e",
          schedule: "52 14 * * *",
          recurring: false,
          prompt: "Check whether the server is still serving.",
        },
      ],
    });

    expect(tracker.getSnapshot()).toMatchObject({
      retained: true,
      foregroundWaits: [],
      backgroundWork: [
        {
          id: "b7sd0wkj1",
          kind: "shell",
          label: "Start HTTP server on port 8782",
          providerType: "local_bash",
          command: "python3 -m http.server 8782",
          startedAt: at.toISOString(),
          source: "claude:background_tasks_changed",
        },
        {
          id: "1fc9478e",
          kind: "cron",
          label: "Check whether the server is still serving.",
          schedule: "52 14 * * *",
          recurring: false,
          source: "claude:stop-hook-session-crons",
        },
      ],
    });

    // The server ends and the cron fires: the level and the next Stop hook
    // clear both.
    tracker.observeMessage({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [],
      session_id: "sess-1",
    } as SDKMessage);
    tracker.observeStopHook({
      hook_event_name: "Stop",
      background_tasks: [],
      session_crons: [],
    });
    expect(tracker.getSnapshot()).toMatchObject({
      retained: false,
      backgroundWork: [],
    });
  });

  it("reports the main thread's blocking tasks as waits, not background work", () => {
    const tracker = new ClaudeProviderRetentionTracker(undefined, () => at);

    tracker.observeMessage({
      type: "system",
      subtype: "task_started",
      task_id: "agent-1",
      description: "Wait then report time",
      subagent_type: "general-purpose",
      is_backgrounded: false,
      spawn_depth: 1,
      task_type: "local_agent",
      session_id: "sess-1",
    } as SDKMessage);
    // The subagent's own blocking Bash call is part of its wait.
    tracker.observeMessage({
      type: "system",
      subtype: "task_started",
      task_id: "bash-1",
      owned_by_subagent: true,
      description: "sleep 120; date",
      is_backgrounded: false,
      parent_task_id: "agent-1",
      task_type: "local_bash",
      session_id: "sess-1",
    } as SDKMessage);

    const during = tracker.getSnapshot();
    expect(during.backgroundWork).toEqual([]);
    expect(during.foregroundWaits).toEqual([
      {
        id: "agent-1",
        kind: "subagent",
        label: "Wait then report time",
        providerType: "local_agent",
        startedAt: at.toISOString(),
        source: "claude:task_started",
      },
    ]);

    // Moving it to the background turns the wait into background work.
    tracker.observeMessage({
      type: "system",
      subtype: "task_updated",
      task_id: "agent-1",
      patch: { is_backgrounded: true },
      session_id: "sess-1",
    } as SDKMessage);
    const moved = tracker.getSnapshot();
    expect(moved.foregroundWaits).toEqual([]);
    expect(moved.backgroundWork?.map((item) => item.id)).toEqual(["agent-1"]);

    tracker.observeMessage({
      type: "system",
      subtype: "task_started",
      task_id: "bash-2",
      description: "Verify server is listening",
      is_backgrounded: false,
      task_type: "local_bash",
      session_id: "sess-1",
    } as SDKMessage);
    expect(
      tracker.getSnapshot().foregroundWaits?.map((item) => item.id),
    ).toEqual(["bash-2"]);
    tracker.observeMessage({
      type: "result",
      session_id: "sess-1",
    } as SDKMessage);
    expect(tracker.getSnapshot().foregroundWaits).toEqual([]);
  });
});
