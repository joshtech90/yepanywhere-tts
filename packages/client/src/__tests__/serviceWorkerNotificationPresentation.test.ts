// @vitest-environment node

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

const serviceWorkerSource = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);

interface FakeWindowClient {
  focused: boolean;
  url: string;
}

interface PushPayload {
  type: string;
  sessionId?: string;
  projectId?: string;
  projectName?: string;
  summary?: string;
  timestamp: string;
}

function loadServiceWorker(indexedDB = new IDBFactory()) {
  const windowClients: FakeWindowClient[] = [];
  const visible = new Map<string, { data?: unknown; close: () => void }>();
  const showNotification = vi.fn(
    async (_title: string, options: { tag: string; data?: unknown }) => {
      visible.set(options.tag, {
        data: options.data,
        close: () => {
          visible.delete(options.tag);
        },
      });
    },
  );
  const workerGlobal = {
    addEventListener: vi.fn(),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windowClients),
    },
    registration: {
      scope: "https://example.test/remote/",
      getNotifications: vi.fn(async ({ tag }: { tag: string }) =>
        visible.has(tag) ? [visible.get(tag)] : [],
      ),
      showNotification,
    },
  };
  const context = vm.createContext({
    URL,
    indexedDB,
    console: {
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    },
    self: workerGlobal,
  });
  new vm.Script(serviceWorkerSource, { filename: "sw.js" }).runInContext(
    context,
  );

  const handlePush = vm.runInContext("(data) => handlePush(data)", context) as (
    payload: PushPayload,
  ) => Promise<void>;
  const setNotifyInApp = (enabled: boolean) => {
    vm.runInContext(`settings.notifyInApp = ${String(enabled)}`, context);
  };
  // What a page's postMessage delivers, including the worker's waitUntil.
  const postMessage = async (data: unknown) => {
    const listener = workerGlobal.addEventListener.mock.calls.find(
      ([type]) => type === "message",
    )?.[1] as (event: unknown) => unknown;
    const pending: Promise<unknown>[] = [];
    await listener({
      data,
      ports: [],
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
  };

  return {
    handlePush,
    postMessage,
    setNotifyInApp,
    showNotification,
    windowClients,
    visible,
  };
}

function pendingInputPayload(): PushPayload {
  return {
    type: "pending-input",
    sessionId: "session-1",
    projectId: "project-1",
    projectName: "Example",
    summary: "Waiting for approval",
    timestamp: "2026-07-31T12:00:00.000Z",
  };
}

describe("service worker notification presentation", () => {
  it("keeps a newer approval when an older dismiss arrives late", async () => {
    const worker = loadServiceWorker();
    await worker.handlePush({
      ...pendingInputPayload(),
      timestamp: "2026-10-22T12:00:02.000Z",
    });
    await worker.handlePush({
      type: "dismiss",
      sessionId: "session-1",
      timestamp: "2026-10-22T12:00:01.000Z",
    });
    expect(worker.visible.has("session-session-1")).toBe(true);
  });

  it("remembers dismissal across worker restart and rejects delayed approval", async () => {
    const db = new IDBFactory();
    await loadServiceWorker(db).handlePush({
      type: "dismiss",
      sessionId: "session-1",
      timestamp: "2026-10-22T12:00:01.000Z",
    });
    const worker = loadServiceWorker(db);
    await worker.handlePush({
      ...pendingInputPayload(),
      timestamp: "2026-10-22T12:00:00.000Z",
    });
    expect(worker.showNotification).not.toHaveBeenCalled();
  });

  it("serializes overlapping display and dismissal and deduplicates a later replay", async () => {
    const db = new IDBFactory();
    const worker = loadServiceWorker(db);
    const pending = pendingInputPayload();
    await Promise.all([
      worker.handlePush(pending),
      worker.handlePush({
        type: "dismiss",
        sessionId: pending.sessionId,
        timestamp: pending.timestamp,
      }),
    ]);
    expect(worker.visible.size).toBe(0);
    const restarted = loadServiceWorker(db);
    const completed = { ...pending, type: "session-halted" };
    await restarted.handlePush(completed);
    await restarted.handlePush(completed);
    expect(restarted.showNotification).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no YA windows", []],
    [
      "an unfocused YA window",
      [
        {
          focused: false,
          url: "https://example.test/remote/sessions/session-1",
        },
      ],
    ],
  ])("shows an eligible push with %s", async (_label, clients) => {
    const worker = loadServiceWorker();
    worker.windowClients.push(...clients);

    await worker.handlePush(pendingInputPayload());

    expect(worker.showNotification).toHaveBeenCalledTimes(1);
  });

  it("suppresses an eligible push while YA is focused by default", async () => {
    const worker = loadServiceWorker();
    worker.windowClients.push({
      focused: true,
      url: "https://example.test/remote/projects",
    });

    await worker.handlePush(pendingInputPayload());

    expect(worker.showNotification).not.toHaveBeenCalled();
  });

  it("shows a push for another session after the focused-window opt-in", async () => {
    const worker = loadServiceWorker();
    worker.setNotifyInApp(true);
    worker.windowClients.push({
      focused: true,
      url: "https://example.test/remote/sessions/session-2",
    });

    await worker.handlePush(pendingInputPayload());

    expect(worker.showNotification).toHaveBeenCalledTimes(1);
  });

  it("keeps the focused-window opt-in after the worker restarts", async () => {
    const db = new IDBFactory();
    await loadServiceWorker(db).postMessage({
      type: "setting-update",
      key: "notifyInApp",
      value: true,
    });
    // An idle worker is stopped; the next push starts a fresh instance.
    const restarted = loadServiceWorker(db);
    restarted.windowClients.push({
      focused: true,
      url: "https://example.test/remote/sessions/session-2",
    });

    await restarted.handlePush(pendingInputPayload());

    expect(restarted.showNotification).toHaveBeenCalledTimes(1);

    // Turning it off again must also survive the next restart.
    await restarted.postMessage({
      type: "setting-update",
      key: "notifyInApp",
      value: false,
    });
    const again = loadServiceWorker(db);
    again.windowClients.push({
      focused: true,
      url: "https://example.test/remote/sessions/session-2",
    });
    await again.handlePush({
      ...pendingInputPayload(),
      timestamp: "2026-07-31T12:00:05.000Z",
    });
    expect(again.showNotification).not.toHaveBeenCalled();
  });

  it("still suppresses the session already visible in a focused window", async () => {
    const worker = loadServiceWorker();
    worker.setNotifyInApp(true);
    worker.windowClients.push({
      focused: true,
      url: "https://example.test/remote/sessions/session-1",
    });

    await worker.handlePush(pendingInputPayload());

    expect(worker.showNotification).not.toHaveBeenCalled();
  });

  it("always presents an explicitly requested test push", async () => {
    const worker = loadServiceWorker();
    worker.windowClients.push({
      focused: true,
      url: "https://example.test/remote/sessions/session-1",
    });

    await worker.handlePush({
      type: "test",
      timestamp: "2026-07-31T12:00:00.000Z",
    });

    expect(worker.showNotification).toHaveBeenCalledTimes(1);
  });
});
