/**
 * Background worker of the Chrome extension (docs/tactical/151).
 *
 * - Serves the app shell for path navigations, so reloads and deep links
 *   work under BrowserRouter.
 * - Runs the toolbar button: open the side panel, or focus the YA tab, and
 *   its right-click menu.
 * - Looks up issue pages on granted sites as tabs navigate and puts the
 *   session count on the toolbar badge.
 *
 * Chrome stops this worker when idle. It holds no state it cannot rebuild:
 * saved hosts come from the pages' mirror in `chrome.storage.local`, and
 * host connections are reopened on demand.
 */

import { issueLookupUrl } from "@yep-anywhere/shared";
import {
  appTabRouteKey,
  CLICKED_TAB_KEY,
  createAppPage,
  focusOrOpenApp,
} from "./appTab";
import { type ChromeTab, getChrome } from "./chrome";
import { countIssueSessions } from "./lookup";
import { restoreDevReload } from "./devReload";
import {
  activeHosts,
  loadMirroredHosts,
  mirroredHostCredentials,
} from "./savedHosts";
import {
  allowlistPermits,
  DEFAULT_EXTENSION_SETTINGS,
  type ExtensionSettings,
  loadExtensionSettings,
  subscribeExtensionSettings,
} from "./settings";

/** The parts of the service-worker scope used here; the client has no WebWorker lib. */
interface FetchEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
const worker = globalThis as unknown as {
  location: Location;
  registration: ServiceWorkerRegistration;
  addEventListener(
    type: "activate",
    listener: () => void,
    options: { once: boolean },
  ): void;
  addEventListener(
    type: "fetch",
    listener: (event: FetchEventLike) => void,
  ): void;
};

const APP_ENTRY = "/index.html";
const LOOKUP_DELAY_MS = 800;
const COUNT_TTL_MS = 2 * 60_000;
const COUNT_CACHE_PREFIX = "ya.count.";

const chrome = getChrome()!;

// A bounded, one-shot dev reload hint survives runtime.reload's context loss.
// Bounded by the dev snapshot's 256-window limit, consumed on toolbar clicks.
const devReopenWindows = __EXTENSION_DEV_WORKER_HASH__
  ? new Set<number>()
  : undefined;
if (__EXTENSION_DEV_WORKER_HASH__) {
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if ((message as { kind?: string })?.kind === "ya-dev-worker")
      respond({ workerHash: __EXTENSION_DEV_WORKER_HASH__ });
    return false;
  });
  const restore = () =>
    void (async () => {
      for (const windowId of await restoreDevReload(chrome)) {
        try {
          await chrome.sidePanel.open({ windowId });
        } catch {
          // Chrome may reject reopening without a fresh user gesture. The next
          // toolbar click reopens the panel even if its normal action is App tab.
          devReopenWindows?.add(windowId);
          await chrome.action.setTitle({
            title:
              "Development extension updated — click to reopen the side panel",
          });
          await chrome.action.setBadgeText({ text: "↻" });
        }
      }
    })().catch(() => {});
  // Deep-link app tabs need this worker's navigation fetch handler. Opening
  // them during installation races activation and produces ERR_FILE_NOT_FOUND.
  if (worker.registration.active?.state === "activated") restore();
  else
    worker.addEventListener(
      "activate",
      () => {
        const active = worker.registration.active;
        if (active?.state === "activated") restore();
        else {
          const activated = () => {
            if (active?.state !== "activated") return;
            active.removeEventListener("statechange", activated);
            restore();
          };
          active?.addEventListener("statechange", activated);
        }
      },
      { once: true },
    );
}

// The toolbar click must open the side panel within its user gesture, so
// the setting it consults is kept in memory rather than read on click.
let settings: ExtensionSettings = DEFAULT_EXTENSION_SETTINGS;
const settingsReady = loadExtensionSettings().then((loaded) => {
  settings = loaded;
});
subscribeExtensionSettings((next) => {
  settings = next;
  showMenuSidePanel(next);
  if (next.badge === "off" || !next.automaticLookup) void clearAllBadges();
});

// The client routes by path (/-/relay/<user>/projects/...), but the extension
// holds only packaged files. Answer navigations to any other path with the app
// shell, as a web host's SPA fallback would, so reloads and deep links work.
worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return;
  event.respondWith(fetch(APP_ENTRY));
});

chrome.runtime.onInstalled.addListener(() => {
  // The worker decides per click, since the toolbar setting can change.
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  // Menu items persist across worker restarts; recreate them on update.
  void Promise.all([chrome.contextMenus.removeAll(), settingsReady]).then(
    () => {
      for (const item of MENU_ITEMS)
        chrome.contextMenus.create({ ...item, contexts: ["action"] });
      showMenuSidePanel(settings);
    },
  );
});

function openSidePanel(tab: ChromeTab): void {
  // Call open first: it must run inside the click's user gesture.
  const opening = chrome.sidePanel.open({ windowId: tab.windowId });
  // The click grants activeTab, so the URL is readable now even on a site
  // without granted access; the panel looks that page up once.
  if (tab.id !== undefined)
    void chrome.storage.session.set({
      [CLICKED_TAB_KEY]: { tabId: tab.id, url: tab.url },
    });
  void opening.catch(() => {});
}

chrome.action.onClicked.addListener((tab) => {
  if (__EXTENSION_DEV_WORKER_HASH__ && devReopenWindows?.delete(tab.windowId)) {
    openSidePanel(tab);
    void chrome.action.setTitle({ title: "Yep Anywhere" });
    void chrome.action.setBadgeText({ text: "" });
    return;
  }
  if (settings.toolbarAction === "side-panel") openSidePanel(tab);
  else void focusOrOpenApp();
});

// --- Toolbar button menu ---------------------------------------------------

// Titles are fixed English, like the manifest's: the worker does not load
// the client's message catalog.
const MENU_ITEMS = [
  { id: "open-app", title: "Open Yep Anywhere" },
  { id: "open-popup", title: "Open Yep Anywhere in a popup window" },
  { id: "open-side-panel", title: "Open the side panel" },
] as const;

/** The side panel item duplicates a click unless the click opens the app. */
function showMenuSidePanel(current: ExtensionSettings): void {
  void chrome.contextMenus
    .update("open-side-panel", {
      visible: current.toolbarAction !== "side-panel",
    })
    .catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-side-panel") {
    if (tab) openSidePanel(tab);
  } else if (info.menuItemId === "open-popup")
    void createAppPage("/", { popup: true });
  else if (info.menuItemId === "open-app") void focusOrOpenApp();
});

// --- Automatic lookup and the badge ---------------------------------------

const pending = new Map<number, ReturnType<typeof setTimeout>>();
const shown = new Map<number, string>();

async function setBadge(tabId: number, text: string): Promise<void> {
  if (shown.get(tabId) === text) return;
  shown.set(tabId, text);
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

async function clearAllBadges(): Promise<void> {
  for (const tabId of [...shown.keys()]) await setBadge(tabId, "");
}

async function cachedCount(
  identity: string,
  compute: () => Promise<number | null>,
): Promise<number | null> {
  const key = `${COUNT_CACHE_PREFIX}${identity}`;
  const cached = (await chrome.storage.session.get(key))[key] as
    | { count: number; at: number }
    | undefined;
  if (cached && Date.now() - cached.at < COUNT_TTL_MS) return cached.count;
  const count = await compute();
  if (count !== null)
    await chrome.storage.session.set({ [key]: { count, at: Date.now() } });
  return count;
}

async function lookUpTab(tabId: number, url: string | undefined) {
  await settingsReady;
  const reference = url ? issueLookupUrl(url) : null;
  if (
    !url ||
    !reference ||
    !settings.automaticLookup ||
    settings.badge === "off" ||
    !allowlistPermits(settings.lookupAllowlist, reference.key)
  ) {
    await setBadge(tabId, "");
    return;
  }
  const hosts = activeHosts(await loadMirroredHosts(), settings);
  if (hosts.length === 0) return;
  const count = await cachedCount(reference.identity, () =>
    countIssueSessions(url, hosts, {
      includeDismissed: settings.includeDismissed,
      credentials: mirroredHostCredentials,
    }),
  );
  // The tab may have moved on while the hosts answered.
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.url !== url) return;
  await setBadge(tabId, count ? String(count) : "");
}

function schedule(tabId: number, url: string | undefined): void {
  clearTimeout(pending.get(tabId));
  pending.set(
    tabId,
    setTimeout(() => {
      pending.delete(tabId);
      void lookUpTab(tabId, url).catch(() => {});
    }, LOOKUP_DELAY_MS),
  );
}

// `tab.url` is present only for sites the user granted, so this sees nothing
// else. GitHub and Jira change URLs in place; each change is a new lookup.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "loading") {
    // A navigation ends the toolbar click's one-page grant, and with it the
    // address this worker recorded for the side panel.
    void chrome.storage.session.get(CLICKED_TAB_KEY).then((stored) => {
      const clicked = stored[CLICKED_TAB_KEY] as { tabId?: number } | undefined;
      if (clicked?.tabId === tabId)
        void chrome.storage.session.remove(CLICKED_TAB_KEY);
    });
  }
  if (change.url !== undefined || change.status === "complete")
    schedule(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTimeout(pending.get(tabId));
  pending.delete(tabId);
  shown.delete(tabId);
  // A closing app tab may not finish withdrawing its own route.
  void chrome.storage.session.remove(appTabRouteKey(tabId)).catch(() => {});
});
