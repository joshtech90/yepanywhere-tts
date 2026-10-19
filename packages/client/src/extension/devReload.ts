import { COMPOSE_TAB_KEY } from "./appTab";
import type { ChromeApi, ChromeTab, ChromeWindow } from "./chrome";

// One-shot dev-only snapshot, consumed at startup, never a browsing history.
// Retain the old key so an older footer can still request panel reopening.
export const DEV_RELOAD_KEY = "ya.dev.reopenPanel";
const MAX_TABS = 256;
const MAX_AGE_MS = 30_000;

interface SavedTab {
  id: number;
  windowId: number;
  url: string;
  index: number;
  active: boolean;
  pinned: boolean;
  compose: boolean;
}

interface ReloadState {
  at: number;
  windowId: number;
  tabs?: SavedTab[];
  windows?: ChromeWindow[];
  panels?: number[];
}

function ownUrl(chrome: ChromeApi, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "chrome-extension:" || url.host !== chrome.runtime.id)
      return undefined;
    // Login links can carry credentials. Restore only their bare sign-in page.
    if (url.pathname.startsWith("/login")) {
      url.search = "";
      url.hash = "";
    }
    return url.href;
  } catch {
    return undefined;
  }
}

/** Snapshot only this extension's live pages, without broad tabs permission. */
export async function saveDevReload(chrome: ChromeApi): Promise<void> {
  const [contexts, current, stored] = await Promise.all([
    chrome.runtime.getContexts({ contextTypes: ["TAB", "SIDE_PANEL"] }),
    chrome.windows.getCurrent(),
    chrome.storage.session.get(COMPOSE_TAB_KEY),
  ]);
  if (current.id === undefined) throw new Error("No current extension window");
  const tabs: SavedTab[] = [];
  for (const context of contexts
    .filter((item) => item.contextType === "TAB" && item.frameId === 0)
    .slice(0, MAX_TABS)) {
    const url = ownUrl(chrome, context.documentUrl);
    if (!url || context.tabId < 0) continue;
    const tab = await chrome.tabs.get(context.tabId).catch(() => undefined);
    if (tab?.id === undefined) continue;
    tabs.push({
      id: tab.id,
      windowId: tab.windowId,
      url,
      index: tab.index ?? 0,
      active: tab.active,
      pinned: tab.pinned ?? false,
      compose: stored[COMPOSE_TAB_KEY] === tab.id,
    });
  }
  const panels = [
    ...new Set([
      current.id,
      ...contexts
        .filter((item) => item.contextType === "SIDE_PANEL")
        .map((item) => item.windowId),
    ]),
  ]
    .filter((id) => id >= 0)
    .slice(0, MAX_TABS);
  const windows: ChromeWindow[] = [];
  for (const id of new Set([...tabs.map((tab) => tab.windowId), ...panels])) {
    const window = await chrome.windows.get(id).catch(() => undefined);
    if (!window) continue;
    const { type, focused, left, top, width, height } = window;
    windows.push({ id, type, focused, left, top, width, height });
  }
  const state: ReloadState = {
    at: Date.now(),
    windowId: current.id,
    tabs,
    windows,
    panels,
  };
  await chrome.storage.local.set({ [DEV_RELOAD_KEY]: state });
}

/** Recreate closed pages and reload tabs Chrome reset during extension reload. */
export async function restoreDevReload(chrome: ChromeApi): Promise<number[]> {
  const stored = (await chrome.storage.local.get(DEV_RELOAD_KEY))[
    DEV_RELOAD_KEY
  ] as Partial<ReloadState> | null;
  if (!stored) return [];
  // Remove before opening anything: a worker restart must not replay the snapshot.
  await chrome.storage.local.remove(DEV_RELOAD_KEY);
  if (
    typeof stored.at !== "number" ||
    !Number.isFinite(stored.at) ||
    Date.now() - stored.at < 0 ||
    Date.now() - stored.at > MAX_AGE_MS ||
    !Number.isInteger(stored.windowId)
  )
    return [];
  const windows = new Map<number, number>();
  const tabs = (Array.isArray(stored.tabs) ? stored.tabs : [])
    .slice(0, MAX_TABS)
    .filter(
      (tab) =>
        tab &&
        Number.isInteger(tab.id) &&
        Number.isInteger(tab.windowId) &&
        Number.isInteger(tab.index) &&
        tab.index >= 0 &&
        ownUrl(chrome, tab.url),
    )
    .sort((a, b) => a.index - b.index);
  for (const tab of tabs) {
    const existing = await chrome.tabs.get(tab.id).catch(() => undefined);
    // Chrome can keep a popup's last tab but replace it with New Tab. A URL
    // may also be withheld without tabs permission. Its fresh snapshot proves
    // that this exact tab belonged to us; restore it without duplicating it.
    if (
      existing?.url &&
      !ownUrl(chrome, existing.url) &&
      !["about:blank", "chrome://newtab/", "chrome://new-tab-page/"].includes(
        existing.url,
      )
    ) {
      continue;
    }
    let windowId = existing?.windowId ?? windows.get(tab.windowId);
    if (!existing && windowId === undefined) {
      const existingWindow = await chrome.windows
        .get(tab.windowId)
        .catch(() => undefined);
      windowId = existingWindow?.id;
    }
    let restored: ChromeTab | undefined;
    if (existing?.id !== undefined) {
      restored = await chrome.tabs
        .update(existing.id, {
          url: ownUrl(chrome, tab.url)!,
          active: tab.active === true,
          pinned: tab.pinned === true,
        })
        .catch(() => undefined);
    } else if (windowId === undefined) {
      const savedWindow = (
        Array.isArray(stored.windows) ? stored.windows : []
      ).find((window) => window?.id === tab.windowId);
      const { left, top, width, height } = savedWindow ?? {};
      const options = {
        url: ownUrl(chrome, tab.url)!,
        type:
          savedWindow?.type === "popup"
            ? ("popup" as const)
            : ("normal" as const),
        focused: savedWindow?.focused === true,
      };
      const created = await chrome.windows
        .create({ ...options, left, top, width, height })
        .catch(() => chrome.windows.create(options))
        .catch(() => undefined);
      windowId = created?.id;
      restored = created?.tabs?.[0];
    } else {
      restored = await chrome.tabs
        .create({
          url: ownUrl(chrome, tab.url)!,
          windowId,
          index: tab.index,
          active: tab.active === true,
          pinned: tab.pinned === true,
        })
        .catch(() => undefined);
    }
    if (windowId !== undefined) windows.set(tab.windowId, windowId);
    if (restored?.id !== undefined) {
      if (tab.pinned)
        await chrome.tabs.update(restored.id, { pinned: true }).catch(() => {});
      if (tab.compose)
        await chrome.storage.session.set({ [COMPOSE_TAB_KEY]: restored.id });
    }
  }
  const panels = Array.isArray(stored.panels)
    ? stored.panels
    : [stored.windowId!];
  return [
    ...new Set(
      panels
        .filter((id) => Number.isInteger(id) && id >= 0)
        .slice(0, MAX_TABS)
        .map((id) => windows.get(id) ?? id),
    ),
  ];
}
