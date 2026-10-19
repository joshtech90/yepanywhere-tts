import {
  PROVIDER_WORK_ITEM_LIMIT,
  type ProviderWorkItem,
  type ProviderWorkKind,
} from "@yep-anywhere/shared";
import type { ProviderRetentionSnapshot, SDKMessage } from "../types.js";

type StopHookLike = {
  hook_event_name?: unknown;
  background_tasks?: unknown;
  session_crons?: unknown;
};

type TaskPatchLike = {
  status?: unknown;
  is_backgrounded?: unknown;
};

type BackgroundTaskLike = {
  task_id?: unknown;
  ambient?: unknown;
  task_type?: unknown;
  description?: unknown;
  subagent_type?: unknown;
  parent_task_id?: unknown;
};

interface RetainedTask {
  status: string;
  isBackgrounded?: boolean;
}

/** What the SDK told us about a task; feeds work items, not retention. */
interface ClaudeTaskInfo {
  taskType?: string;
  description?: string;
  subagentType?: string;
  parentTaskId?: string;
  isBackgrounded?: boolean;
  firstSeenAt: string;
}

/** A Stop-hook `background_tasks` entry, which alone carries the command. */
interface StopHookTask {
  type?: string;
  description?: string;
  command?: string;
  firstSeenAt: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Map an SDK `task_type` or Stop-hook friendly type to a work kind. Unknown
 * types stay visible as "other" with their raw type.
 */
function claudeWorkKind(type: string | undefined): ProviderWorkKind {
  switch (type) {
    case "local_bash":
    case "shell":
      return "shell";
    case "local_agent":
    case "subagent":
      return "subagent";
    case "local_workflow":
    case "workflow":
      return "workflow";
    case "mcp_task":
    case "MCP task":
      return "mcp";
  }
  return type?.includes("monitor") ? "monitor" : "other";
}

const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "killed",
  "stopped",
]);

function readTaskId(message: SDKMessage): string | null {
  return typeof message.task_id === "string" && message.task_id
    ? message.task_id
    : null;
}

function readTaskPatch(message: SDKMessage): TaskPatchLike | null {
  const patch = message.patch;
  return patch && typeof patch === "object" ? patch : null;
}

interface BackgroundTaskEntry {
  taskId: string;
  ambient: boolean;
  taskType?: string;
  description?: string;
  subagentType?: string;
  parentTaskId?: string;
}

function readBackgroundTasks(
  message: SDKMessage,
): BackgroundTaskEntry[] | null {
  if (!Array.isArray(message.tasks)) {
    return null;
  }

  const tasks: BackgroundTaskEntry[] = [];
  for (const task of message.tasks) {
    if (!task || typeof task !== "object") {
      return null;
    }
    const entry = task as BackgroundTaskLike;
    const taskId = entry.task_id;
    if (typeof taskId !== "string" || !taskId) {
      return null;
    }
    tasks.push({
      taskId,
      ambient: entry.ambient === true,
      taskType: optionalString(entry.task_type),
      description: optionalString(entry.description),
      subagentType: optionalString(entry.subagent_type),
      parentTaskId: optionalString(entry.parent_task_id),
    });
  }
  return tasks;
}

function isStopHookInput(input: unknown): input is StopHookLike {
  return (
    !!input &&
    typeof input === "object" &&
    (input as StopHookLike).hook_event_name === "Stop"
  );
}

export class ClaudeProviderRetentionTracker {
  private stopBackgroundTaskCount = 0;
  private stopSessionCronCount = 0;
  private retainedTasks = new Map<string, RetainedTask>();
  private backgroundTaskSnapshotSeen = false;
  private lastUpdatedAt: Date | null = null;
  // Work-item state. It describes what retains the session; it never
  // decides `retained`, which the counts above own.
  private readonly taskInfo = new Map<string, ClaudeTaskInfo>();
  private stopHookTasks = new Map<string, StopHookTask>();
  private sessionCrons: ProviderWorkItem[] = [];
  private readonly foregroundTaskIds = new Set<string>();

  constructor(
    private readonly onChange?: () => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getSnapshot(): ProviderRetentionSnapshot {
    const reasons: string[] = [];
    if (this.stopBackgroundTaskCount > 0) {
      reasons.push(
        `stop-hook-background-tasks:${this.stopBackgroundTaskCount}`,
      );
    }
    if (this.stopSessionCronCount > 0) {
      reasons.push(`stop-hook-session-crons:${this.stopSessionCronCount}`);
    }
    if (this.retainedTasks.size > 0) {
      reasons.push(`sdk-live-tasks:${this.retainedTasks.size}`);
    }

    return {
      retained: reasons.length > 0,
      reasons,
      backgroundTaskCount: this.stopBackgroundTaskCount,
      sessionCronCount: this.stopSessionCronCount,
      liveTaskCount: this.retainedTasks.size,
      lastUpdatedAt: this.lastUpdatedAt,
      backgroundWork: this.backgroundWork(),
      foregroundWaits: this.foregroundWaits(),
    };
  }

  private backgroundWork(): ProviderWorkItem[] {
    const ids = new Set<string>();
    for (const id of this.retainedTasks.keys()) {
      // Before the first level snapshot, edge-derived entries include
      // blocking tasks, the main thread's and its subagents'; those are
      // waits, not background work.
      if (
        this.backgroundTaskSnapshotSeen ||
        this.taskInfo.get(id)?.isBackgrounded !== false
      ) {
        ids.add(id);
      }
    }
    if (!this.backgroundTaskSnapshotSeen && this.stopBackgroundTaskCount > 0) {
      for (const id of this.stopHookTasks.keys()) ids.add(id);
    }
    const items = [...ids].map((id) =>
      this.taskWorkItem(
        id,
        this.backgroundTaskSnapshotSeen
          ? "claude:background_tasks_changed"
          : "claude:task-lifecycle",
      ),
    );
    return [...items, ...this.sessionCrons].slice(0, PROVIDER_WORK_ITEM_LIMIT);
  }

  private foregroundWaits(): ProviderWorkItem[] {
    return [...this.foregroundTaskIds]
      .map((id) => this.taskWorkItem(id, "claude:task_started"))
      .slice(0, PROVIDER_WORK_ITEM_LIMIT);
  }

  private taskWorkItem(id: string, source: string): ProviderWorkItem {
    const info = this.taskInfo.get(id);
    const stopHook = this.stopHookTasks.get(id);
    const providerType = info?.taskType ?? stopHook?.type;
    const description = info?.description ?? stopHook?.description;
    const item: ProviderWorkItem = {
      id,
      kind: claudeWorkKind(providerType),
      label: description ?? stopHook?.command ?? id,
      source,
    };
    if (providerType) item.providerType = providerType;
    if (stopHook?.command) item.command = stopHook.command;
    const startedAt = info?.firstSeenAt ?? stopHook?.firstSeenAt;
    if (startedAt) item.startedAt = startedAt;
    if (info?.parentTaskId) item.parentId = info.parentTaskId;
    return item;
  }

  observeStopHook(input: unknown): void {
    if (!isStopHookInput(input)) {
      return;
    }

    const previous = this.snapshotKey();
    const backgroundTasks = Array.isArray(input.background_tasks)
      ? input.background_tasks
      : null;
    const sessionCrons = Array.isArray(input.session_crons)
      ? input.session_crons
      : null;

    if (backgroundTasks === null && sessionCrons === null) {
      return;
    }

    if (backgroundTasks !== null) {
      this.stopBackgroundTaskCount = this.backgroundTaskSnapshotSeen
        ? 0
        : backgroundTasks.length;
    }
    if (sessionCrons !== null) {
      this.stopSessionCronCount = sessionCrons.length;
    }
    if (backgroundTasks !== null) {
      this.recordStopHookTasks(backgroundTasks);
    }
    if (sessionCrons !== null) {
      this.recordSessionCrons(sessionCrons);
    }
    if (
      !this.backgroundTaskSnapshotSeen &&
      backgroundTasks !== null &&
      sessionCrons !== null &&
      backgroundTasks.length === 0 &&
      sessionCrons.length === 0
    ) {
      this.retainedTasks.clear();
    }
    this.markUpdated(previous);
  }

  observeMessage(message: SDKMessage): void {
    if (message.type === "result") {
      // A foreground task cannot outlive the turn that blocked on it.
      if (this.foregroundTaskIds.size > 0) {
        const previous = this.snapshotKey();
        this.foregroundTaskIds.clear();
        this.markUpdated(previous);
      }
      return;
    }
    if (message.type !== "system") {
      return;
    }

    switch (message.subtype) {
      case "background_tasks_changed":
        this.observeBackgroundTasksChanged(message);
        break;
      case "task_started":
        if (message.ambient === true) {
          this.clearTaskFromMessage(message);
          break;
        }
        // Retain first so the task's metadata survives pruning.
        this.retainTaskFromMessage(message, "running");
        this.recordTaskStarted(message);
        break;
      case "task_progress":
        this.retainTaskFromMessage(message, "running");
        break;
      case "task_updated":
        this.observeTaskUpdated(message);
        break;
      case "task_notification":
        this.endForegroundTask(readTaskId(message));
        this.clearTaskFromMessage(message);
        break;
    }
  }

  private recordTaskStarted(message: SDKMessage): void {
    const taskId = readTaskId(message);
    if (!taskId) return;
    const previous = this.snapshotKey();
    this.rememberTask(taskId, {
      taskType: optionalString(message.task_type),
      description: optionalString(message.description),
      subagentType: optionalString(message.subagent_type),
      parentTaskId: optionalString(message.parent_task_id),
      isBackgrounded:
        typeof message.is_backgrounded === "boolean"
          ? message.is_backgrounded
          : undefined,
    });
    // Only the main thread's own blocking calls are waits; a subagent's
    // tools run inside the subagent's wait.
    if (
      message.is_backgrounded === false &&
      !message.parent_task_id &&
      message.owned_by_subagent !== true
    ) {
      this.foregroundTaskIds.add(taskId);
    }
    this.markUpdated(previous);
  }

  private endForegroundTask(taskId: string | null): void {
    if (!taskId || !this.foregroundTaskIds.has(taskId)) return;
    const previous = this.snapshotKey();
    this.foregroundTaskIds.delete(taskId);
    this.markUpdated(previous);
  }

  private rememberTask(
    taskId: string,
    info: Omit<ClaudeTaskInfo, "firstSeenAt">,
  ): void {
    const existing = this.taskInfo.get(taskId);
    this.taskInfo.set(taskId, {
      taskType: info.taskType ?? existing?.taskType,
      description: info.description ?? existing?.description,
      subagentType: info.subagentType ?? existing?.subagentType,
      parentTaskId: info.parentTaskId ?? existing?.parentTaskId,
      isBackgrounded: info.isBackgrounded ?? existing?.isBackgrounded,
      firstSeenAt: existing?.firstSeenAt ?? this.now().toISOString(),
    });
  }

  private recordStopHookTasks(entries: unknown[]): void {
    const next = new Map<string, StopHookTask>();
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const raw = entry as Record<string, unknown>;
      const id = optionalString(raw.id);
      if (!id) continue;
      next.set(id, {
        type: optionalString(raw.type),
        description: optionalString(raw.description),
        command: optionalString(raw.command),
        firstSeenAt:
          this.stopHookTasks.get(id)?.firstSeenAt ??
          this.taskInfo.get(id)?.firstSeenAt ??
          this.now().toISOString(),
      });
    }
    this.stopHookTasks = next;
  }

  private recordSessionCrons(entries: unknown[]): void {
    const previous = new Map(this.sessionCrons.map((cron) => [cron.id, cron]));
    const crons: ProviderWorkItem[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const raw = entry as Record<string, unknown>;
      const id = optionalString(raw.id);
      if (!id) continue;
      const prompt = optionalString(raw.prompt);
      const item: ProviderWorkItem = {
        id,
        kind: "cron",
        label: prompt ?? id,
        startedAt: previous.get(id)?.startedAt ?? this.now().toISOString(),
        source: "claude:stop-hook-session-crons",
      };
      const schedule = optionalString(raw.schedule);
      if (schedule) item.schedule = schedule;
      if (typeof raw.recurring === "boolean") item.recurring = raw.recurring;
      crons.push(item);
    }
    this.sessionCrons = crons;
  }

  private observeBackgroundTasksChanged(message: SDKMessage): void {
    const tasks = readBackgroundTasks(message);
    if (!tasks) {
      return;
    }

    const previous = this.snapshotKey();
    for (const task of tasks) {
      if (task.ambient) continue;
      this.rememberTask(task.taskId, { ...task, isBackgrounded: true });
      // A foreground task joining the level was moved to the background.
      this.foregroundTaskIds.delete(task.taskId);
    }
    this.backgroundTaskSnapshotSeen = true;
    this.stopBackgroundTaskCount = 0;
    this.retainedTasks = new Map(
      tasks
        .filter((task) => !task.ambient)
        .map((task) => [
          task.taskId,
          { status: "running", isBackgrounded: true },
        ]),
    );
    this.markUpdated(previous);
  }

  private retainTaskFromMessage(message: SDKMessage, status: string): void {
    if (this.backgroundTaskSnapshotSeen) {
      return;
    }
    const taskId = readTaskId(message);
    if (!taskId) {
      return;
    }

    const previous = this.snapshotKey();
    this.retainedTasks.set(taskId, {
      status,
      isBackgrounded: this.retainedTasks.get(taskId)?.isBackgrounded,
    });
    this.markUpdated(previous);
  }

  private observeTaskUpdated(message: SDKMessage): void {
    const taskId = readTaskId(message);
    const patch = readTaskPatch(message);
    if (!taskId || !patch) {
      return;
    }
    if (patch.is_backgrounded === true) {
      const info = this.taskInfo.get(taskId);
      if (info) info.isBackgrounded = true;
    }
    if (
      patch.is_backgrounded === true ||
      (typeof patch.status === "string" &&
        TERMINAL_TASK_STATUSES.has(patch.status))
    ) {
      this.endForegroundTask(taskId);
    }
    if (this.backgroundTaskSnapshotSeen) {
      return;
    }

    const status = typeof patch.status === "string" ? patch.status : undefined;
    if (status && TERMINAL_TASK_STATUSES.has(status)) {
      this.clearTask(taskId);
      return;
    }

    const existing = this.retainedTasks.get(taskId);
    const shouldRetain =
      !!status ||
      patch.is_backgrounded === true ||
      (patch.is_backgrounded === false && !!existing);
    if (!shouldRetain) {
      return;
    }

    const previous = this.snapshotKey();
    this.retainedTasks.set(taskId, {
      status: status ?? existing?.status ?? "unknown",
      isBackgrounded:
        typeof patch.is_backgrounded === "boolean"
          ? patch.is_backgrounded
          : existing?.isBackgrounded,
    });
    this.markUpdated(previous);
  }

  private clearTaskFromMessage(message: SDKMessage): void {
    if (this.backgroundTaskSnapshotSeen) {
      return;
    }
    const taskId = readTaskId(message);
    if (!taskId) {
      return;
    }
    this.clearTask(taskId);
  }

  private clearTask(taskId: string): void {
    if (!this.retainedTasks.has(taskId)) {
      return;
    }

    const previous = this.snapshotKey();
    this.retainedTasks.delete(taskId);
    this.markUpdated(previous);
  }

  private markUpdated(previousKey: string): void {
    this.lastUpdatedAt = new Date();
    this.pruneTaskInfo();
    if (this.snapshotKey() !== previousKey) {
      this.onChange?.();
    }
  }

  /** Forget metadata for tasks that no longer appear anywhere. */
  private pruneTaskInfo(): void {
    for (const id of this.taskInfo.keys()) {
      if (
        !this.retainedTasks.has(id) &&
        !this.foregroundTaskIds.has(id) &&
        !this.stopHookTasks.has(id)
      ) {
        this.taskInfo.delete(id);
      }
    }
  }

  private snapshotKey(): string {
    const tasks = Array.from(this.retainedTasks.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([id, task]) =>
          `${id}:${task.status}:${task.isBackgrounded === true ? "bg" : "fg"}`,
      )
      .join(",");
    return [
      this.stopBackgroundTaskCount,
      this.stopSessionCronCount,
      tasks,
      JSON.stringify([this.backgroundWork(), this.foregroundWaits()]),
    ].join("|");
  }
}
