/**
 * Opening YA routes in the extension's app tab from the side panel or the
 * background worker. The tab navigates inside the app, keeping its
 * connections and state, rather than reloading.
 */

import { DESKTOP_BREAKPOINT } from "../hooks/useSidebarWidth";
import { getChrome, type ChromeTab } from "./chrome";
import { loadExtensionSettings } from "./settings";

export const NAVIGATE_MESSAGE = "ya-extension-navigate";

/**
 * `chrome.storage.session` record of the tab the toolbar button was clicked
 * on, written by the background worker for the side panel.
 */
export const CLICKED_TAB_KEY = "ya.clickedTab";

export interface NavigateMessage {
  type: typeof NAVIGATE_MESSAGE;
  tabId: number;
  path: string;
}

export function isNavigateMessage(value: unknown): value is NavigateMessage {
  const message = value as Partial<NavigateMessage> | null;
  return (
    !!message &&
    message.type === NAVIGATE_MESSAGE &&
    typeof message.tabId === "number" &&
    typeof message.path === "string" &&
    message.path.startsWith("/")
  );
}

/**
 * `chrome.storage.session` list of tab ids showing the YA app. Without the
 * `tabs` permission Chrome hides even this extension's own tab URLs, so app
 * tabs register themselves instead of being found by URL.
 */
const APP_TABS_KEY = "ya.appTabs";

/**
 * `chrome.storage.session` key of an app tab's current route, which the app
 * tab publishes for the side panel for the same reason.
 */
export function appTabRouteKey(tabId: number): string {
  return `ya.appTabRoute.${tabId}`;
}

async function appTabIds(): Promise<number[]> {
  const chrome = getChrome();
  const stored = chrome
    ? (await chrome.storage.session.get(APP_TABS_KEY))[APP_TABS_KEY]
    : undefined;
  return Array.isArray(stored)
    ? stored.filter((id): id is number => typeof id === "number")
    : [];
}

/** Record the calling page's tab as an app tab until it unloads. */
export async function registerAppTab(): Promise<() => void> {
  const chrome = getChrome();
  const tab = await chrome?.tabs.getCurrent().catch(() => undefined);
  if (!chrome || tab?.id === undefined) return () => {};
  const id = tab.id;
  await chrome.storage.session.set({
    [APP_TABS_KEY]: [
      ...(await appTabIds()).filter((other) => other !== id),
      id,
    ],
  });
  const unregister = () =>
    void appTabIds().then((ids) =>
      chrome.storage.session.set({
        [APP_TABS_KEY]: ids.filter((other) => other !== id),
      }),
    );
  window.addEventListener("pagehide", unregister);
  return () => {
    window.removeEventListener("pagehide", unregister);
    unregister();
  };
}

/**
 * `chrome.storage.session` id of the tab in the new-session popup window. It
 * is an app tab, but only the new-session button ever navigates it.
 */
export const COMPOSE_TAB_KEY = "ya.composeTab";

async function composeTabId(): Promise<number | undefined> {
  const chrome = getChrome();
  const stored = chrome
    ? (await chrome.storage.session.get(COMPOSE_TAB_KEY))[COMPOSE_TAB_KEY]
    : undefined;
  return typeof stored === "number" ? stored : undefined;
}

/** The most recently used tab showing the YA app, if any. */
export async function findAppTab(): Promise<ChromeTab | undefined> {
  const chrome = getChrome();
  if (!chrome) return undefined;
  // Never the caller's own tab (the panel page opened in a tab, say).
  const own = await chrome.tabs.getCurrent().catch(() => undefined);
  const compose = await composeTabId();
  const tabs = await Promise.all(
    (await appTabIds())
      .filter((id) => id !== own?.id && id !== compose)
      .map((id) => chrome.tabs.get(id).catch(() => null)),
  );
  return tabs
    .filter((tab): tab is ChromeTab => tab?.id !== undefined)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

/**
 * `chrome.storage.local` size and place of the last YA popup window, saved by
 * the popup itself, since Chrome does not remember them for created windows.
 */
const POPUP_BOUNDS_KEY = "ya.popupBounds";
/** The new-session popup's own size and place, so the two never mix. */
const COMPOSE_BOUNDS_KEY = "ya.composePopupBounds";

interface PopupBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DEFAULT_POPUP_SIZE = { width: 480, height: 860 };
const DEFAULT_COMPOSE_SIZE = { width: 480, height: 760 };

function isPopupBounds(value: unknown): value is PopupBounds {
  const bounds = value as Partial<PopupBounds> | null;
  return (
    !!bounds &&
    [bounds.left, bounds.top, bounds.width, bounds.height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
  );
}

/**
 * Open `path` in a new app page: a tab, or a popup window when preferred or
 * asked for.
 */
export async function createAppPage(
  path: string,
  options: { popup?: boolean } = {},
): Promise<void> {
  const chrome = getChrome();
  if (!chrome) return;
  const url = chrome.runtime.getURL(path);
  if (!options.popup && (await loadExtensionSettings()).appWindow !== "popup") {
    await chrome.tabs.create({ url });
    return;
  }
  await createPopup(url, POPUP_BOUNDS_KEY, DEFAULT_POPUP_SIZE);
}

async function createPopup(
  url: string,
  boundsKey: string,
  fallback: { width: number; height: number },
  maxWidth = Number.POSITIVE_INFINITY,
): Promise<{ id?: number; tabs?: ChromeTab[] } | undefined> {
  const chrome = getChrome();
  if (!chrome) return undefined;
  const saved = (await chrome.storage.local.get(boundsKey))[boundsKey];
  const popup = { url, type: "popup", focused: true } as const;
  const bounds = isPopupBounds(saved) ? saved : fallback;
  // Chrome rejects bounds mostly off every display, as after unplugging one.
  return chrome.windows
    .create({ ...popup, ...bounds, width: Math.min(bounds.width, maxWidth) })
    .catch(() => chrome.windows.create({ ...popup, ...fallback }));
}

/**
 * Show `path` in the new-session popup window, opening it when it is not
 * open. It stays narrower than the desktop layout, so the app shows no
 * sidebar, and the panel's session links never take it over.
 */
export async function openComposeWindow(path: string): Promise<void> {
  const chrome = getChrome();
  if (!chrome) return;
  const id = await composeTabId();
  const tab =
    id === undefined ? undefined : await chrome.tabs.get(id).catch(() => null);
  if (tab?.id === undefined) {
    const created = await createPopup(
      chrome.runtime.getURL(path),
      COMPOSE_BOUNDS_KEY,
      DEFAULT_COMPOSE_SIZE,
      DESKTOP_BREAKPOINT - 1,
    );
    const createdTab = created?.tabs?.[0]?.id;
    if (createdTab !== undefined)
      await chrome.storage.session.set({ [COMPOSE_TAB_KEY]: createdTab });
    return;
  }
  const routeKey = appTabRouteKey(tab.id);
  const route = (await chrome.storage.session.get(routeKey))[routeKey];
  if (route === path)
    await chrome.windows.update(tab.windowId, { focused: true });
  else await showInTab(tab as ChromeTab & { id: number }, path);
}

/** Bring the YA tab forward as it is, or open a new app page. */
export async function focusOrOpenApp(): Promise<void> {
  const chrome = getChrome();
  if (!chrome) return;
  const tab = await findAppTab();
  if (tab?.id === undefined) {
    await createAppPage("/");
    return;
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

/** In a YA popup window, save its size and place for the next popup. */
export function rememberPopupBounds(): () => void {
  const chrome = getChrome();
  if (!chrome) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let boundsKey = POPUP_BOUNDS_KEY;
  const save = () => {
    clearTimeout(timer);
    const bounds: PopupBounds = {
      left: window.screenX,
      top: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
    };
    void chrome.storage.local.set({ [boundsKey]: bounds }).catch(() => {});
  };
  const resized = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  let attached = false;
  let disposed = false;
  void Promise.all([
    chrome.windows.getCurrent().catch(() => undefined),
    chrome.tabs.getCurrent().catch(() => undefined),
    composeTabId().catch(() => undefined),
  ]).then(([current, own, compose]) => {
    if (disposed || current?.type !== "popup") return;
    if (own?.id !== undefined && own.id === compose)
      boundsKey = COMPOSE_BOUNDS_KEY;
    attached = true;
    // Moving a window fires no event a page can see; closing saves it.
    window.addEventListener("resize", resized);
    window.addEventListener("pagehide", save);
  });
  return () => {
    disposed = true;
    clearTimeout(timer);
    if (!attached) return;
    window.removeEventListener("resize", resized);
    window.removeEventListener("pagehide", save);
  };
}

/** Show `path` in the YA tab, or in a new page when asked or when none exists. */
export async function openInApp(
  path: string,
  options: { newTab?: boolean } = {},
): Promise<void> {
  const chrome = getChrome();
  if (!chrome) return;
  const tab = options.newTab ? undefined : await findAppTab();
  if (tab?.id === undefined) {
    await createAppPage(path);
    return;
  }
  await showInTab(tab as ChromeTab & { id: number }, path);
}

/** Navigate an app tab to `path` in place and bring it forward. */
async function showInTab(
  tab: ChromeTab & { id: number },
  path: string,
): Promise<void> {
  const chrome = getChrome();
  if (!chrome) return;
  const message: NavigateMessage = {
    type: NAVIGATE_MESSAGE,
    tabId: tab.id,
    path,
  };
  const handled = await chrome.runtime.sendMessage(message).catch(() => false);
  // A tab still loading, or on the sign-in page, does not answer: load the URL.
  await chrome.tabs.update(
    tab.id,
    handled === true
      ? { active: true }
      : { active: true, url: chrome.runtime.getURL(path) },
  );
  await chrome.windows.update(tab.windowId, { focused: true });
}
