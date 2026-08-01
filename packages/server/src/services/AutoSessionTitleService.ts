/**
 * AutoSessionTitleService names new sessions with the cheap helper model.
 *
 * Without it, the session list shows each session's first user message,
 * truncated to 120 characters. That is a poor list key: several sessions can
 * open with the same boilerplate, and the actual topic often sits past the
 * cutoff. This service watches sessions as they start, and once a session has
 * enough of an opening to be recognizable it asks the provider's cheapest
 * helper model (Haiku for Claude) for a short name and stores it as the
 * session's custom title.
 *
 * Guarantees:
 * - It never overwrites a title the user set (custom titles are left alone).
 * - It titles each session at most once per server lifetime; a failure is
 *   remembered so a broken provider is not retried in a loop.
 * - The helper query is non-persisted, so nothing lands in the provider
 *   transcript and no session is reactivated or forked to be titled.
 *
 * See topics/auto-session-title.md.
 */

import {
  HELPER_SIDE_MODEL_CHEAPEST,
  normalizeGeneratedSessionTitle,
  type AutoSessionTitleSettings,
  type ProviderName,
  type UrlProjectId,
} from "@yep-anywhere/shared";
import { getLogger } from "../logging/logger.js";
import type { SummaryGenerationResult } from "../sdk/providers/types.js";
import type { EventBus } from "../watcher/EventBus.js";

/** Opening context the service needs in order to title a session. */
export interface AutoTitleSessionContext {
  provider: ProviderName;
  /** Complete first user message (not the 120-char list truncation). */
  fullTitle: string | null;
  /** Excerpt of the first agent turn, when one exists yet. */
  lastAgentText?: string;
  /** Conversation messages currently on the session's active branch. */
  messageCount: number;
}

export interface AutoSessionTitleServiceOptions {
  eventBus: EventBus;
  /** Current settings; read per attempt so toggling takes effect at once. */
  getSettings: () => AutoSessionTitleSettings;
  /** Custom title already stored for a session, if any. */
  getCustomTitle: (sessionId: string) => string | undefined;
  /** Persist the generated title. */
  setTitle: (sessionId: string, title: string) => Promise<void>;
  /** Resolve the opening context, or null when the session cannot be read. */
  loadContext: (
    sessionId: string,
    projectId: UrlProjectId,
  ) => Promise<AutoTitleSessionContext | null>;
  /** Run the provider's side-session title helper. */
  generateTitle: (
    provider: ProviderName,
    request: {
      transcriptExcerpt: string;
      currentTitle?: string;
      lengthTarget: number;
      language: AutoSessionTitleSettings["language"];
      model: string;
      signal: AbortSignal;
    },
  ) => Promise<SummaryGenerationResult>;
  /** Overridable for tests. */
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Hard ceiling on concurrent helper queries. Sessions are titled one at a
 * time: a burst of new sessions should never fan out into a burst of provider
 * processes competing with the user's own work.
 */
const MAX_CONCURRENT_TITLE_JOBS = 1;

/**
 * How recent a session must be to count as "new".
 *
 * The index emits `session-created` for every session it indexes on a cold
 * start, so without this the first server start after enabling the feature
 * would try to title the entire session history. Deciding from the event's own
 * timestamp keeps that check free — no transcript read for sessions that are
 * plainly too old — and it survives restarts, unlike an in-memory
 * seen-at-startup set.
 */
export const AUTO_SESSION_TITLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type SessionOutcome = "pending" | "done" | "failed" | "skipped";

export class AutoSessionTitleService {
  private readonly options: AutoSessionTitleServiceOptions;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  /** Sessions already handled (or deliberately skipped) this server lifetime. */
  private readonly outcomes = new Map<string, SessionOutcome>();
  /** Debounce timers keyed by session id. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Sessions waiting for a free worker slot, in arrival order. */
  private readonly queue: Array<{
    sessionId: string;
    projectId: UrlProjectId;
  }> = [];
  private activeJobs = 0;
  private unsubscribe?: () => void;
  private stopped = false;

  constructor(options: AutoSessionTitleServiceOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.stopped = false;
    this.unsubscribe = this.options.eventBus.subscribe((event) => {
      if (event.type === "session-created") {
        this.observe(
          event.session.id,
          event.session.projectId,
          event.session.updatedAt ?? event.session.createdAt,
        );
        return;
      }
      if (event.type === "session-updated") {
        this.observe(
          event.sessionId,
          event.projectId,
          event.updatedAt ?? event.timestamp,
        );
        return;
      }
      if (event.type === "session-metadata-changed") {
        // A rename (by the user, or any other explicit title write) means this
        // session is spoken for; never generate over it. Skip sessions this
        // service titled itself — its own emit lands back here, and treating
        // that as a foreign rename would overwrite the "done" outcome.
        if (
          typeof event.title === "string" &&
          event.title.trim() &&
          this.outcomes.get(event.sessionId) !== "done"
        ) {
          this.outcomes.set(event.sessionId, "skipped");
          this.cancelTimer(event.sessionId);
        }
      }
    });
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const timer of this.timers.values()) {
      this.clearTimeoutFn(timer);
    }
    this.timers.clear();
    this.queue.length = 0;
  }

  /** Test/diagnostic view of what the service decided per session. */
  getOutcome(sessionId: string): SessionOutcome | undefined {
    return this.outcomes.get(sessionId);
  }

  private observe(
    sessionId: string,
    projectId: UrlProjectId,
    activityAt?: string,
  ): void {
    if (this.stopped) return;
    const settings = this.options.getSettings();
    if (!settings.enabled) return;
    if (this.outcomes.has(sessionId)) return;
    if (this.timers.has(sessionId)) return;
    if (!settings.backfillExisting && this.isStale(activityAt)) {
      this.outcomes.set(sessionId, "skipped");
      return;
    }
    if (this.options.getCustomTitle(sessionId)?.trim()) {
      this.outcomes.set(sessionId, "skipped");
      return;
    }

    // Debounce: a session emits many updates while its first turn streams.
    // Waiting lets the opening settle so the helper sees a real exchange
    // instead of a half-written first message.
    const delayMs = Math.max(0, settings.delaySeconds) * 1000;
    const timer = this.setTimeoutFn(() => {
      this.timers.delete(sessionId);
      this.enqueue(sessionId, projectId);
    }, delayMs);
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  /**
   * True when the session's last activity is older than the freshness window.
   * An unparseable or missing timestamp counts as fresh: the transcript read
   * that follows is the authority, and dropping a genuinely new session is
   * worse than one wasted lookup.
   */
  private isStale(activityAt: string | undefined): boolean {
    if (!activityAt) return false;
    const activityMs = Date.parse(activityAt);
    if (!Number.isFinite(activityMs)) return false;
    return this.now() - activityMs > AUTO_SESSION_TITLE_MAX_AGE_MS;
  }

  private cancelTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) {
      this.clearTimeoutFn(timer);
      this.timers.delete(sessionId);
    }
  }

  private enqueue(sessionId: string, projectId: UrlProjectId): void {
    if (this.stopped) return;
    if (this.outcomes.has(sessionId)) return;
    this.outcomes.set(sessionId, "pending");
    this.queue.push({ sessionId, projectId });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.activeJobs >= MAX_CONCURRENT_TITLE_JOBS) return;
    const next = this.queue.shift();
    if (!next) return;

    this.activeJobs += 1;
    try {
      await this.titleSession(next.sessionId, next.projectId);
    } finally {
      this.activeJobs -= 1;
      if (this.queue.length > 0) void this.drain();
    }
  }

  private async titleSession(
    sessionId: string,
    projectId: UrlProjectId,
  ): Promise<void> {
    if (this.stopped) return;
    const settings = this.options.getSettings();
    if (!settings.enabled) {
      this.outcomes.set(sessionId, "skipped");
      return;
    }
    // Re-check: the user may have renamed the session during the delay.
    if (this.options.getCustomTitle(sessionId)?.trim()) {
      this.outcomes.set(sessionId, "skipped");
      return;
    }

    const startedAt = this.now();
    try {
      const context = await this.options.loadContext(sessionId, projectId);
      if (!context) {
        this.outcomes.set(sessionId, "failed");
        return;
      }
      if (context.messageCount < settings.triggerMessageCount) {
        // Not enough of an opening yet. Clear the outcome so a later update
        // re-arms the debounce instead of the session never being titled.
        this.outcomes.delete(sessionId);
        return;
      }

      const excerpt = buildTranscriptExcerpt(context);
      if (!excerpt) {
        this.outcomes.set(sessionId, "skipped");
        return;
      }

      const abortController = new AbortController();
      const generated = await this.options.generateTitle(context.provider, {
        transcriptExcerpt: excerpt,
        currentTitle: context.fullTitle?.slice(0, 200) || undefined,
        lengthTarget: settings.maxLength,
        language: settings.language,
        model: HELPER_SIDE_MODEL_CHEAPEST,
        signal: abortController.signal,
      });

      const title = normalizeGeneratedSessionTitle(
        generated.text,
        settings.maxLength,
      );
      if (!title) {
        this.outcomes.set(sessionId, "failed");
        getLogger().warn(
          { event: "auto_session_title_empty", sessionId, projectId },
          "Auto session title returned no usable text",
        );
        return;
      }

      // Last check before writing: a rename during generation wins.
      if (this.options.getCustomTitle(sessionId)?.trim()) {
        this.outcomes.set(sessionId, "skipped");
        return;
      }

      await this.options.setTitle(sessionId, title);
      this.outcomes.set(sessionId, "done");
      this.options.eventBus.emit({
        type: "session-metadata-changed",
        sessionId,
        title,
        timestamp: new Date().toISOString(),
      });
      getLogger().info(
        {
          event: "auto_session_title_set",
          sessionId,
          projectId,
          provider: context.provider,
          title,
          durationMs: this.now() - startedAt,
        },
        "Auto session title set",
      );
    } catch (error) {
      this.outcomes.set(sessionId, "failed");
      getLogger().warn(
        {
          event: "auto_session_title_failed",
          sessionId,
          projectId,
          durationMs: this.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        },
        "Auto session title generation failed",
      );
    }
  }
}

/**
 * Compose the excerpt handed to the helper model.
 *
 * The first user message carries the ask; the first agent turn disambiguates
 * terse openers. Labels are plain so the helper does not mistake them for
 * instructions.
 */
export function buildTranscriptExcerpt(
  context: AutoTitleSessionContext,
): string {
  const parts: string[] = [];
  const opening = context.fullTitle?.trim();
  if (opening) {
    parts.push(`User:\n${opening}`);
  }
  const agent = context.lastAgentText?.trim();
  if (agent) {
    parts.push(`Assistant:\n${agent}`);
  }
  return parts.join("\n\n").trim();
}
