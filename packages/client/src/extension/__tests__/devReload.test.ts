import { describe, expect, it, vi } from "vitest";
import { COMPOSE_TAB_KEY } from "../appTab";
import type { ChromeApi } from "../chrome";
import { DEV_RELOAD_KEY, restoreDevReload, saveDevReload } from "../devReload";

const base = "chrome-extension://test-extension";

function fixture() {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  let nextTab = 100;
  const chrome = {
    runtime: {
      id: "test-extension",
      getContexts: vi.fn().mockResolvedValue([]),
    },
    storage: {
      local: {
        get: async () => local,
        set: async (items: object) => Object.assign(local, items),
        remove: async (key: string) => {
          delete local[key];
        },
      },
      session: {
        get: async () => session,
        set: async (items: object) => Object.assign(session, items),
      },
    },
    tabs: {
      get: vi.fn().mockRejectedValue(new Error("Tab was closed")),
      create: vi.fn().mockImplementation(async (options: object) => ({
        id: nextTab++,
        ...options,
      })),
      update: vi.fn().mockResolvedValue({}),
    },
    windows: {
      getCurrent: vi.fn().mockResolvedValue({ id: 1 }),
      get: vi.fn().mockResolvedValue({ id: 1, type: "normal" }),
      create: vi.fn().mockResolvedValue({ id: 2, tabs: [{ id: 200 }] }),
    },
  };
  return { api: chrome as unknown as ChromeApi, chrome, local, session };
}

function tab(id: number, index: number, url = `${base}/sessions/${id}`) {
  return {
    id,
    windowId: 1,
    index,
    url,
    active: index === 1,
    pinned: false,
    compose: false,
  };
}

describe("development reload snapshot", () => {
  it("saves exact own-page routes and strips credentials from login links", async () => {
    const { api, chrome, local } = fixture();
    const route = `${base}/-/relay/demo/projects/p/sessions/123?view=tools#message-7`;
    chrome.runtime.getContexts.mockResolvedValue([
      {
        contextType: "TAB",
        frameId: 0,
        tabId: 10,
        windowId: 1,
        documentUrl: route,
      },
      {
        contextType: "TAB",
        frameId: 0,
        tabId: 11,
        windowId: 1,
        documentUrl: `${base}/login/relay#u=user&p=secret`,
      },
      {
        contextType: "TAB",
        frameId: 0,
        tabId: 12,
        windowId: 1,
        documentUrl: "https://unrelated.test/",
      },
      {
        contextType: "TAB",
        frameId: 1,
        tabId: 13,
        windowId: 1,
        documentUrl: `${base}/embedded.html`,
      },
    ]);
    chrome.tabs.get.mockImplementation(async (id: number) => ({
      id,
      windowId: 1,
      index: id - 10,
      active: id === 10,
    }));
    await saveDevReload(api);
    expect(local[DEV_RELOAD_KEY]).toMatchObject({
      tabs: [
        { id: 10, url: route },
        { id: 11, url: `${base}/login/relay` },
      ],
    });
    expect(JSON.stringify(local)).not.toContain("secret");
  });

  it("restores closed tabs in order, preserves compose identity, and consumes the snapshot once", async () => {
    const { api, chrome, local, session } = fixture();
    local[DEV_RELOAD_KEY] = {
      at: Date.now(),
      windowId: 1,
      tabs: [
        { ...tab(11, 1), compose: true },
        tab(10, 0),
        tab(12, 2, "https://must-not-open.test/"),
      ],
    };
    expect(await restoreDevReload(api)).toEqual([1]);
    expect(chrome.tabs.create.mock.calls.map(([options]) => options)).toEqual([
      {
        url: `${base}/sessions/10`,
        windowId: 1,
        index: 0,
        active: false,
        pinned: false,
      },
      {
        url: `${base}/sessions/11`,
        windowId: 1,
        index: 1,
        active: true,
        pinned: false,
      },
    ]);
    expect(session[COMPOSE_TAB_KEY]).toBe(101);
    expect(await restoreDevReload(api)).toEqual([]);
    expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
  });

  it("recreates a closed popup window but leaves surviving tabs alone", async () => {
    const { api, chrome, local } = fixture();
    chrome.tabs.get.mockImplementation(async (id: number) => {
      if (id === 10) return { id, windowId: 9, url: "https://other.test/" };
      throw new Error("closed");
    });
    chrome.windows.get.mockRejectedValue(new Error("window closed"));
    local[DEV_RELOAD_KEY] = {
      at: Date.now(),
      windowId: 1,
      tabs: [tab(10, 0), tab(11, 1)],
      windows: [
        {
          id: 1,
          type: "popup",
          left: 10,
          top: 20,
          width: 480,
          height: 760,
          focused: true,
        },
      ],
    };
    expect(await restoreDevReload(api)).toEqual([2]);
    expect(chrome.windows.create).toHaveBeenCalledWith({
      url: `${base}/sessions/11`,
      type: "popup",
      left: 10,
      top: 20,
      width: 480,
      height: 760,
      focused: true,
    });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("discards expired and future snapshots instead of reopening old pages", async () => {
    const { api, chrome, local } = fixture();
    for (const at of [Date.now() - 31_000, Date.now() + 60_000]) {
      local[DEV_RELOAD_KEY] = { at, windowId: 1, tabs: [tab(10, 0)] };
      expect(await restoreDevReload(api)).toEqual([]);
      expect(local[DEV_RELOAD_KEY]).toBeUndefined();
    }
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("restores a popup tab Chrome reset to New Tab without duplicating it", async () => {
    const { api, chrome, local } = fixture();
    chrome.tabs.get.mockResolvedValue({
      id: 10,
      windowId: 1,
      url: "chrome://new-tab-page/",
    });
    chrome.tabs.update.mockResolvedValue({ id: 10, windowId: 1 });
    local[DEV_RELOAD_KEY] = { at: Date.now(), windowId: 1, tabs: [tab(10, 0)] };
    expect(await restoreDevReload(api)).toEqual([1]);
    expect(chrome.tabs.update).toHaveBeenCalledWith(10, {
      url: `${base}/sessions/10`,
      active: false,
      pinned: false,
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});
