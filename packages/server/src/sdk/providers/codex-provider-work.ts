import {
  PROVIDER_WORK_ITEM_LIMIT,
  type ProviderWorkItem,
} from "@yep-anywhere/shared";
import type { ProviderRetentionSnapshot } from "../types.js";

interface NotificationLike {
  method: string;
  params?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isoFromMs(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined;
}

/** The model-facing command, e.g. `sleep 300` rather than `zsh -lc '…'`. */
function commandLabel(item: Record<string, unknown>): string | undefined {
  const actions = item.commandActions;
  if (Array.isArray(actions) && actions.length === 1) {
    const command = optionalString(record(actions[0])?.command);
    if (command) return command;
  }
  return optionalString(item.command);
}

/**
 * Records Codex work its thread status does not show: unified-exec
 * processes and subagent threads that are still running, during or after
 * their turn, and what the active turn waits on (`clock.sleep`,
 * `wait_agent`). It sees every notification as it arrives, so work that ends
 * between turns clears at once. Codex work is recorded but never retains the
 * session (topics/provider-wait-and-background-work.md).
 */
export class CodexProviderWorkTracker {
  private readonly terminals = new Map<string, ProviderWorkItem>();
  private readonly subagents = new Map<string, ProviderWorkItem>();
  private readonly waits = new Map<string, ProviderWorkItem>();
  private lastUpdatedAt: Date | null = null;
  private reconcileGeneration = 0;
  /** Items that ended while a list request was in flight, if one is. */
  private endedDuringReconcile: Set<string> | null = null;

  constructor(
    private readonly onChange: () => void,
    private readonly listBackgroundTerminals: () => Promise<unknown>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getSnapshot(): ProviderRetentionSnapshot {
    return {
      retained: false,
      reasons: [],
      lastUpdatedAt: this.lastUpdatedAt,
      backgroundWork: [
        ...this.terminals.values(),
        ...this.subagents.values(),
      ].slice(0, PROVIDER_WORK_ITEM_LIMIT),
      foregroundWaits: [...this.waits.values()],
    };
  }

  /** A new app-server process: the previous one's terminals died with it. */
  reset(): void {
    this.reconcileGeneration++;
    this.endedDuringReconcile = null;
    if (
      this.terminals.size === 0 &&
      this.subagents.size === 0 &&
      this.waits.size === 0
    ) {
      return;
    }
    this.terminals.clear();
    this.subagents.clear();
    this.waits.clear();
    this.changed();
  }

  observe(notification: NotificationLike, threadId: string): void {
    const params = record(notification.params);
    if (!params) return;
    // Subagent threads report their own items; only the session's thread
    // belongs to this session.
    if (threadId && params.threadId !== threadId) return;

    switch (notification.method) {
      case "item/started":
        this.itemStarted(record(params.item), params.startedAtMs);
        return;
      case "item/completed":
        this.itemCompleted(record(params.item));
        return;
      case "turn/completed":
        // Nothing waits once the turn has ended.
        if (this.waits.size > 0) {
          this.waits.clear();
          this.changed();
        }
        void this.reconcile();
        return;
      case "thread/closed":
        this.reset();
        return;
    }
  }

  private itemStarted(
    item: Record<string, unknown> | null,
    startedAtMs: unknown,
  ): void {
    const id = optionalString(item?.id);
    if (!item || !id) return;
    const startedAt = isoFromMs(startedAtMs) ?? this.now().toISOString();

    if (item.type === "sleep") {
      const durationMs = item.durationMs;
      this.waits.set(id, {
        id,
        kind: "sleep",
        label: "clock.sleep",
        providerType: "clock.sleep",
        startedAt,
        ...(typeof durationMs === "number" && Number.isFinite(durationMs)
          ? {
              until: new Date(Date.parse(startedAt) + durationMs).toISOString(),
            }
          : {}),
        source: "codex:item/started",
      });
      this.changed();
      return;
    }

    if (
      item.type === "collabAgentToolCall" &&
      item.tool === "wait" &&
      item.status === "inProgress"
    ) {
      this.waits.set(id, {
        id,
        kind: "subagent",
        label: "wait_agent",
        providerType: "collaboration.wait_agent",
        startedAt,
        source: "codex:item/started",
      });
      this.changed();
      return;
    }

    if (item.type === "subAgentActivity") {
      this.subAgentActivity(item, startedAt);
      return;
    }

    // Only unified-exec processes can outlive their tool call.
    if (
      item.type !== "commandExecution" ||
      item.source !== "unifiedExecStartup" ||
      item.status !== "inProgress"
    ) {
      return;
    }
    const command = optionalString(item.command);
    this.terminals.set(id, {
      id,
      kind: "shell",
      label: commandLabel(item) ?? id,
      providerType: "unifiedExecStartup",
      ...(command ? { command } : {}),
      startedAt,
      source: "codex:item/started",
    });
    this.changed();
  }

  private itemCompleted(item: Record<string, unknown> | null): void {
    const id = optionalString(item?.id);
    if (!id) return;
    this.endedDuringReconcile?.add(id);
    if (this.waits.delete(id) || this.terminals.delete(id)) this.changed();
  }

  /** A child agent thread runs alongside its parent until it completes. */
  private subAgentActivity(
    item: Record<string, unknown>,
    startedAt: string,
  ): void {
    const threadId = optionalString(item.agentThreadId);
    if (!threadId) return;
    if (item.kind === "started") {
      if (this.subagents.has(threadId)) return;
      const path = optionalString(item.agentPath);
      this.subagents.set(threadId, {
        id: threadId,
        kind: "subagent",
        label: path ?? threadId,
        providerType: "subAgentActivity",
        startedAt,
        source: "codex:subAgentActivity",
      });
      this.changed();
    } else if (
      (item.kind === "completed" || item.kind === "interrupted") &&
      this.subagents.delete(threadId)
    ) {
      this.changed();
    }
  }

  /**
   * Align with `thread/backgroundTerminals/list` once per turn boundary
   * (no polling). It catches exits Codex never reported and processes YA
   * missed. Older or non-experimental servers simply fail the request.
   */
  private async reconcile(): Promise<void> {
    const generation = ++this.reconcileGeneration;
    const ended = new Set<string>();
    this.endedDuringReconcile = ended;
    const knownAtRequest = new Set(this.terminals.keys());
    let response: unknown;
    try {
      response = await this.listBackgroundTerminals();
    } catch {
      response = null;
    }
    if (generation !== this.reconcileGeneration) return;
    this.endedDuringReconcile = null;
    const data = record(response)?.data;
    if (!Array.isArray(data)) return;

    const listed = new Map<string, Record<string, unknown>>();
    for (const entry of data) {
      const terminal = record(entry);
      const id = optionalString(terminal?.itemId);
      if (terminal && id) listed.set(id, terminal);
    }
    let changed = false;
    for (const id of knownAtRequest) {
      if (!listed.has(id) && this.terminals.delete(id)) changed = true;
    }
    for (const [id, terminal] of listed) {
      if (this.terminals.has(id) || ended.has(id)) {
        continue;
      }
      const command = optionalString(terminal.command);
      this.terminals.set(id, {
        id,
        kind: "shell",
        label: command ?? id,
        providerType: "unifiedExecStartup",
        ...(command ? { command } : {}),
        source: "codex:thread/backgroundTerminals/list",
      });
      changed = true;
    }
    if (changed) this.changed();
  }

  private changed(): void {
    this.lastUpdatedAt = this.now();
    this.onChange();
  }
}
