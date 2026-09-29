// @vitest-environment node

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const serviceWorkerSource = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);

interface FakeWindowClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

function windowClient(url: string): FakeWindowClient {
  const client: FakeWindowClient = {
    url,
    focus: vi.fn(async () => client),
    navigate: vi.fn(async () => client),
    postMessage: vi.fn(),
  };
  return client;
}

function loadServiceWorker(windowClients: FakeWindowClient[]) {
  const openWindow = vi.fn(async () => null);
  const workerGlobal = {
    addEventListener: vi.fn(),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windowClients),
      openWindow,
    },
    registration: {
      scope: "https://example.test/remote/",
      getNotifications: vi.fn(async () => []),
      showNotification: vi.fn(async () => undefined),
    },
  };
  const context = vm.createContext({
    URL,
    console: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), info: vi.fn() },
    self: workerGlobal,
  });
  new vm.Script(serviceWorkerSource, { filename: "sw.js" }).runInContext(
    context,
  );
  const click = vm.runInContext(
    "(data) => handleNotificationClick(data)",
    context,
  ) as (data: Record<string, string>) => Promise<unknown>;
  return { click, openWindow };
}

describe("service worker notification clicks", () => {
  it("opens a session in the Cockpit", async () => {
    const { click, openWindow } = loadServiceWorker([]);

    await click({ sessionId: "session-1", projectId: "project-1" });

    expect(openWindow).toHaveBeenCalledWith(
      "https://example.test/remote/cockpit/projects/project-1/sessions/session-1",
    );
  });

  it("moves a classic tab of the same session into the Cockpit", async () => {
    const classic = windowClient(
      "https://example.test/remote/projects/project-1/sessions/session-1",
    );
    const { click } = loadServiceWorker([classic]);

    await click({ sessionId: "session-1", projectId: "project-1" });

    expect(classic.navigate).toHaveBeenCalledWith(
      "https://example.test/remote/cockpit/projects/project-1/sessions/session-1",
    );
  });

  it("focuses a Cockpit tab that already shows the session", async () => {
    const cockpit = windowClient(
      "https://example.test/remote/cockpit/projects/project-1/sessions/session-1",
    );
    const { click, openWindow } = loadServiceWorker([cockpit]);

    await click({ sessionId: "session-1", projectId: "project-1" });

    expect(cockpit.focus).toHaveBeenCalled();
    expect(cockpit.navigate).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("sends project notifications to the Cockpit overview", async () => {
    const { click, openWindow } = loadServiceWorker([]);

    await click({ target: "project", projectId: "project-1" });

    expect(openWindow).toHaveBeenCalledWith(
      "https://example.test/remote/cockpit",
    );
  });
});
