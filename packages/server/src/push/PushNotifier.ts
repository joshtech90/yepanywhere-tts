/**
 * PushNotifier - Sends push notifications for session attention events
 *
 * Listens to EventBus for process state changes and sends push notifications
 * when a session enters waiting-input state (tool approval or user question)
 * or stops after active work. The service worker on the client handles
 * suppressing notifications when the app is already focused.
 */

import { basename } from "node:path";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { decodeProjectId, getProjectName } from "../projects/paths.js";
import type { Process } from "../supervisor/Process.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import type { InputRequest } from "../supervisor/types.js";
import type {
  BusEvent,
  EventBus,
  ProcessStateEvent,
  ProcessTerminatedEvent,
  SessionAbortedEvent,
} from "../watcher/EventBus.js";
import type { PushService } from "./PushService.js";
import type {
  DismissPayload,
  PendingInputPayload,
  SessionHaltedPayload,
} from "./types.js";

export interface PushNotifierOptions {
  eventBus: EventBus;
  pushService: PushService;
  supervisor: Supervisor;
}

interface NotificationState {
  active: boolean;
  stoppedAtUserTurn?: number;
  errorNotified: boolean;
}

export class PushNotifier {
  private eventBus: EventBus;
  private pushService: PushService;
  private supervisor: Supervisor;
  private unsubscribe: (() => void) | null = null;
  /** Track sessions we've sent notifications for (to know when to send dismiss) */
  private sessionsWithNotification = new Set<string>();
  // Key by process lifetime: replacement sessions cannot inherit suppression,
  // and terminated processes do not leave an unbounded session-id ledger.
  private processStates = new WeakMap<Process, NotificationState>();
  private disposed = false;

  constructor(options: PushNotifierOptions) {
    this.eventBus = options.eventBus;
    this.pushService = options.pushService;
    this.supervisor = options.supervisor;

    // Subscribe to EventBus for process state changes
    this.unsubscribe = this.eventBus.subscribe((event: BusEvent) => {
      if (this.disposed) return;
      if (event.type === "process-state-changed") {
        void this.handleProcessStateChange(event);
      } else if (event.type === "process-terminated") {
        void this.handleProcessTerminated(event);
      } else if (event.type === "session-aborted") {
        this.handleSessionAborted(event);
      }
    });
  }

  /**
   * Handle process state change events.
   * Sends push notification when entering waiting-input state.
   * Sends dismiss when leaving waiting-input state (if we sent a notification).
   */
  private async handleProcessStateChange(
    event: ProcessStateEvent,
  ): Promise<void> {
    const process = this.supervisor.getProcessForSession(event.sessionId);
    const state = process ? this.getNotificationState(process) : undefined;
    // Consume the edge before any asynchronous dismiss/send. Iterator closure
    // can publish another idle event while the first delivery is still pending.
    const completed = state?.active === true && event.activity === "idle";
    if (state) {
      state.active = event.activity !== "idle";
    }

    // Send dismiss when leaving waiting-input (if we sent a notification for it)
    if (event.activity !== "waiting-input") {
      if (this.sessionsWithNotification.delete(event.sessionId)) {
        await this.sendDismiss(event.sessionId);
      }
      if (event.activity !== "idle") {
        return;
      }

      if (!completed) {
        return;
      }

      await this.handleSessionIdle(event);
      return;
    }

    // Check if there are any subscriptions
    if (this.pushService.getSubscriptionCount() === 0) {
      return;
    }

    // Get the process to access the InputRequest details
    if (process?.state.type !== "waiting-input") {
      return;
    }
    if (state?.stoppedAtUserTurn !== undefined || this.disposed) return;

    const request = process.state.request;
    const inputType =
      request.type === "tool-approval" ? "tool-approval" : "user-question";

    // Check if this notification type is enabled in settings
    const settingKey =
      inputType === "tool-approval" ? "toolApproval" : "userQuestion";
    if (!this.pushService.isNotificationTypeEnabled(settingKey)) {
      return;
    }

    const projectName = this.getProjectName(event.projectId);
    const summary = this.buildSummary(request);

    const payload: PendingInputPayload = {
      type: "pending-input",
      sessionId: event.sessionId,
      projectId: event.projectId,
      projectName,
      inputType,
      summary,
      requestId: request.id,
      timestamp: event.timestamp,
    };

    try {
      const results = await this.pushService.sendToAll(payload);
      const successCount = results.filter((r) => r.success).length;
      if (successCount > 0 && !this.disposed) {
        console.log(
          `[PushNotifier] Sent pending-input notification to ${successCount}/${results.length} devices`,
        );
        // Track that we sent a notification for this session
        this.sessionsWithNotification.add(event.sessionId);
      }
    } catch (error) {
      console.error("[PushNotifier] Failed to send push notification:", error);
    }
  }

  /**
   * Notify when a live process finishes active work and reaches idle.
   *
   * Supervisor also emits a synthetic idle event while unregistering a process.
   * Ignore that cleanup event by requiring the process to still be present and
   * actually idle, matching the lifecycle webhook semantics.
   */
  private async handleSessionIdle(event: ProcessStateEvent): Promise<void> {
    const process = this.supervisor.getProcessForSession(event.sessionId);
    if (
      this.disposed ||
      process?.state.type !== "idle" ||
      this.getNotificationState(process).stoppedAtUserTurn !== undefined
    ) {
      return;
    }

    await this.sendSessionHalted({
      sessionId: event.sessionId,
      projectId: event.projectId,
      reason: "completed",
      duration: this.getDurationMs(process.startedAt, event.timestamp),
      timestamp: event.timestamp,
    });
  }

  /**
   * Notify when a process terminates unexpectedly.
   */
  private async handleProcessTerminated(
    event: ProcessTerminatedEvent,
  ): Promise<void> {
    const process = this.supervisor.getProcessForSession(event.sessionId);
    if (this.disposed) return;
    if (process) {
      const state = this.getNotificationState(process);
      if (state.stoppedAtUserTurn !== undefined || state.errorNotified) return;
      state.active = false;
      state.errorNotified = true;
    }
    await this.sendSessionHalted({
      sessionId: event.sessionId,
      projectId: event.projectId,
      reason: "error",
      duration: this.getDurationMs(process?.startedAt, event.timestamp),
      timestamp: event.timestamp,
    });
  }

  private handleSessionAborted(event: SessionAbortedEvent): void {
    this.suppressSession(event.sessionId);
  }

  /** Called before an intentional Stop/Kill can emit provider cleanup events. */
  suppressSession(sessionId: string): void {
    const process = this.supervisor.getProcessForSession(sessionId);
    if (process) {
      this.getNotificationState(process).stoppedAtUserTurn =
        process.userTurnVersion;
    }
  }

  private getNotificationState(process: Process): NotificationState {
    let state = this.processStates.get(process);
    if (!state) {
      state = { active: false, errorNotified: false };
      this.processStates.set(process, state);
    }
    // Cleanup may repeat idle/in-turn/waiting-input. Only accepted fresh user
    // work (or a new Process) ends intentional-stop suppression.
    if (
      state.stoppedAtUserTurn !== undefined &&
      state.stoppedAtUserTurn !== process.userTurnVersion
    ) {
      state.stoppedAtUserTurn = undefined;
      state.errorNotified = false;
    }
    return state;
  }

  private async sendSessionHalted(input: {
    sessionId: string;
    projectId: UrlProjectId;
    reason: SessionHaltedPayload["reason"];
    duration: number;
    timestamp: string;
  }): Promise<void> {
    if (this.pushService.getSubscriptionCount() === 0) {
      return;
    }

    if (!this.pushService.isNotificationTypeEnabled("sessionHalted")) {
      return;
    }

    const payload: SessionHaltedPayload = {
      type: "session-halted",
      sessionId: input.sessionId,
      projectId: input.projectId,
      projectName: this.getProjectName(input.projectId),
      reason: input.reason,
      duration: input.duration,
      timestamp: input.timestamp,
    };

    try {
      const results = await this.pushService.sendToAll(payload);
      const successCount = results.filter((r) => r.success).length;
      if (successCount > 0) {
        console.log(
          `[PushNotifier] Sent session-halted notification to ${successCount}/${results.length} devices`,
        );
      }
    } catch (error) {
      console.error(
        "[PushNotifier] Failed to send session-halted notification:",
        error,
      );
    }
  }

  /**
   * Send a dismiss notification to close notifications on all devices.
   */
  private async sendDismiss(sessionId: string): Promise<void> {
    if (this.pushService.getSubscriptionCount() === 0) {
      return;
    }

    const payload: DismissPayload = {
      type: "dismiss",
      sessionId,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.pushService.sendToAll(payload);
      console.log(`[PushNotifier] Sent dismiss for session ${sessionId}`);
    } catch (error) {
      console.error("[PushNotifier] Failed to send dismiss:", error);
    }
  }

  /**
   * Get project name from projectId.
   */
  private getProjectName(projectId: UrlProjectId): string {
    try {
      const projectPath = decodeProjectId(projectId);
      return getProjectName(projectPath);
    } catch {
      return "Unknown Project";
    }
  }

  /**
   * Build a human-readable summary from the InputRequest.
   */
  private buildSummary(request: InputRequest): string {
    if (request.type === "tool-approval") {
      const toolName = request.toolName ?? "Unknown tool";

      // For file operations, try to extract the file path
      if (request.toolInput && typeof request.toolInput === "object") {
        const input = request.toolInput as Record<string, unknown>;
        const filePath = input.file_path ?? input.filePath ?? input.path;
        if (typeof filePath === "string") {
          // Extract just the filename from the path
          const fileName = basename(filePath);
          return `${toolName}: ${fileName}`;
        }
      }

      return `Run: ${toolName}`;
    }

    // For questions/choices, use the prompt text (truncated)
    const prompt = request.prompt ?? "Waiting for input";
    if (prompt.length > 60) {
      return `${prompt.slice(0, 57)}...`;
    }
    return prompt;
  }

  private getDurationMs(
    startedAt: Date | undefined,
    timestamp: string,
  ): number {
    if (!startedAt) {
      return 0;
    }

    const endedAtMs = Date.parse(timestamp);
    const end = Number.isFinite(endedAtMs) ? endedAtMs : Date.now();
    return Math.max(0, end - startedAt.getTime());
  }

  /**
   * Clean up EventBus subscription.
   */
  dispose(): void {
    this.disposed = true;
    this.sessionsWithNotification.clear();
    this.processStates = new WeakMap();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
