import {
  DEFAULT_AUTO_SESSION_TITLE_SETTINGS,
  type AutoSessionTitleSettings,
  type UrlProjectId,
} from "@yep-anywhere/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_SESSION_TITLE_MAX_AGE_MS,
  AutoSessionTitleService,
  buildTranscriptExcerpt,
  type AutoTitleSessionContext,
} from "../../src/services/AutoSessionTitleService.js";
import { EventBus } from "../../src/watcher/EventBus.js";

const PROJECT_ID = "cHJvag" as UrlProjectId;
const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function fixture(
  overrides: {
    settings?: Partial<AutoSessionTitleSettings>;
    context?: Partial<AutoTitleSessionContext> | null;
    generate?: (text: string) => Promise<{ text: string }>;
    customTitle?: string;
  } = {},
) {
  const eventBus = new EventBus();
  const titles = new Map<string, string>();
  const settings: AutoSessionTitleSettings = {
    ...DEFAULT_AUTO_SESSION_TITLE_SETTINGS,
    enabled: true,
    delaySeconds: 0,
    triggerMessageCount: 2,
    ...overrides.settings,
  };
  const context: AutoTitleSessionContext | null =
    overrides.context === null
      ? null
      : {
          provider: "claude",
          fullTitle: "Kannst du bitte bei Stripe die Gebuehren anfragen?",
          lastAgentText: "Ich schreibe den Support an.",
          messageCount: 2,
          ...overrides.context,
        };

  const generateTitle = vi.fn(
    async (): Promise<{ text: string }> => ({ text: "Stripe anfragen" }),
  );
  const loadContext = vi.fn(async () => context);
  const setTitle = vi.fn(async (sessionId: string, title: string) => {
    titles.set(sessionId, title);
  });

  const service = new AutoSessionTitleService({
    eventBus,
    getSettings: () => settings,
    getCustomTitle: (sessionId) =>
      titles.get(sessionId) ?? overrides.customTitle,
    setTitle,
    loadContext,
    generateTitle,
    now: () => NOW,
    // Run the debounce immediately so tests do not depend on wall time.
    setTimeoutFn: ((fn: () => void) => {
      queueMicrotask(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout,
    clearTimeoutFn: (() => {}) as unknown as typeof clearTimeout,
  });

  return { service, eventBus, titles, generateTitle, loadContext, setTitle };
}

/** Let the microtask-based debounce and the async job chain settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

function emitUpdate(
  eventBus: EventBus,
  sessionId: string,
  updatedAt = new Date(NOW).toISOString(),
): void {
  eventBus.emit({
    type: "session-updated",
    sessionId,
    projectId: PROJECT_ID,
    updatedAt,
    timestamp: new Date(NOW).toISOString(),
  });
}

describe("AutoSessionTitleService", () => {
  let harness: ReturnType<typeof fixture>;

  beforeEach(() => {
    harness = fixture();
    harness.service.start();
  });

  it("titles a fresh session and emits the metadata change", async () => {
    const seen: string[] = [];
    harness.eventBus.subscribe((event) => {
      if (event.type === "session-metadata-changed" && event.title) {
        seen.push(event.title);
      }
    });

    emitUpdate(harness.eventBus, "s1");
    await settle();

    expect(harness.titles.get("s1")).toBe("Stripe anfragen");
    expect(seen).toEqual(["Stripe anfragen"]);
    expect(harness.service.getOutcome("s1")).toBe("done");
  });

  it("titles each session only once even under a burst of updates", async () => {
    for (let i = 0; i < 5; i += 1) emitUpdate(harness.eventBus, "s1");
    await settle();
    emitUpdate(harness.eventBus, "s1");
    await settle();

    expect(harness.generateTitle).toHaveBeenCalledTimes(1);
    expect(harness.setTitle).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", async () => {
    const off = fixture({ settings: { enabled: false } });
    off.service.start();
    emitUpdate(off.eventBus, "s1");
    await settle();

    expect(off.generateTitle).not.toHaveBeenCalled();
    expect(off.loadContext).not.toHaveBeenCalled();
  });

  it("never overwrites a title the user already set", async () => {
    const named = fixture({ customTitle: "Von Hand benannt" });
    named.service.start();
    emitUpdate(named.eventBus, "s1");
    await settle();

    expect(named.generateTitle).not.toHaveBeenCalled();
    expect(named.service.getOutcome("s1")).toBe("skipped");
  });

  it("stops generating once the user renames mid-flight", async () => {
    harness.eventBus.emit({
      type: "session-metadata-changed",
      sessionId: "s1",
      title: "Von Hand benannt",
      timestamp: new Date(NOW).toISOString(),
    });
    emitUpdate(harness.eventBus, "s1");
    await settle();

    expect(harness.generateTitle).not.toHaveBeenCalled();
    expect(harness.service.getOutcome("s1")).toBe("skipped");
  });

  it("skips sessions older than the freshness window", async () => {
    emitUpdate(
      harness.eventBus,
      "old",
      new Date(NOW - AUTO_SESSION_TITLE_MAX_AGE_MS - 1000).toISOString(),
    );
    await settle();

    expect(harness.loadContext).not.toHaveBeenCalled();
    expect(harness.service.getOutcome("old")).toBe("skipped");
  });

  it("titles an old session when backfill is enabled", async () => {
    const backfill = fixture({ settings: { backfillExisting: true } });
    backfill.service.start();
    emitUpdate(
      backfill.eventBus,
      "old",
      new Date(NOW - AUTO_SESSION_TITLE_MAX_AGE_MS - 1000).toISOString(),
    );
    await settle();

    expect(backfill.titles.get("old")).toBe("Stripe anfragen");
  });

  it("waits for the trigger message count and retries on a later update", async () => {
    const early = fixture({ context: { messageCount: 1 } });
    early.service.start();
    emitUpdate(early.eventBus, "s1");
    await settle();

    expect(early.generateTitle).not.toHaveBeenCalled();
    expect(early.service.getOutcome("s1")).toBeUndefined();

    early.loadContext.mockResolvedValue({
      provider: "claude",
      fullTitle: "Kannst du bitte bei Stripe die Gebuehren anfragen?",
      lastAgentText: "Ich schreibe den Support an.",
      messageCount: 2,
    });
    emitUpdate(early.eventBus, "s1");
    await settle();

    expect(early.titles.get("s1")).toBe("Stripe anfragen");
  });

  it("marks a session failed when generation throws, and does not retry", async () => {
    const failing = fixture();
    failing.generateTitle.mockRejectedValue(new Error("provider down"));
    failing.service.start();
    emitUpdate(failing.eventBus, "s1");
    await settle();

    expect(failing.service.getOutcome("s1")).toBe("failed");
    expect(failing.setTitle).not.toHaveBeenCalled();

    emitUpdate(failing.eventBus, "s1");
    await settle();
    expect(failing.generateTitle).toHaveBeenCalledTimes(1);
  });

  it("does not store an unusable generated title", async () => {
    const junk = fixture();
    junk.generateTitle.mockResolvedValue({ text: '  "" \n' });
    junk.service.start();
    emitUpdate(junk.eventBus, "s1");
    await settle();

    expect(junk.setTitle).not.toHaveBeenCalled();
    expect(junk.service.getOutcome("s1")).toBe("failed");
  });

  it("stops listening after stop()", async () => {
    harness.service.stop();
    emitUpdate(harness.eventBus, "s1");
    await settle();
    expect(harness.generateTitle).not.toHaveBeenCalled();
  });
});

describe("buildTranscriptExcerpt", () => {
  it("labels the user and assistant turns", () => {
    expect(
      buildTranscriptExcerpt({
        provider: "claude",
        fullTitle: "Frage",
        lastAgentText: "Antwort",
        messageCount: 2,
      }),
    ).toBe("User:\nFrage\n\nAssistant:\nAntwort");
  });

  it("omits an absent agent turn", () => {
    expect(
      buildTranscriptExcerpt({
        provider: "claude",
        fullTitle: "Frage",
        messageCount: 1,
      }),
    ).toBe("User:\nFrage");
  });

  it("returns empty when there is nothing to title", () => {
    expect(
      buildTranscriptExcerpt({
        provider: "claude",
        fullTitle: null,
        messageCount: 0,
      }),
    ).toBe("");
  });
});
