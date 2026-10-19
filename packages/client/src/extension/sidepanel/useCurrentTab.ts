import { useEffect, useState } from "react";
import { appTabRouteKey, CLICKED_TAB_KEY } from "../appTab";
import { getChrome } from "../chrome";

export interface CurrentTab {
  tabId?: number;
  /**
   * Absent when the extension has no access to the tab's address. For the
   * extension's own app tab, whose address Chrome hides without the `tabs`
   * permission, this is the route the tab published.
   */
  url?: string;
  /**
   * The address came from a toolbar click (`activeTab`) rather than granted
   * site access, so the user asked for this page explicitly.
   */
  clicked: boolean;
}

/**
 * The active tab in this panel's window. A `?url=` query on the panel page
 * overrides it, which lets a test or a developer open the panel in a tab.
 */
export function useCurrentTab(): CurrentTab {
  const [current, setCurrent] = useState<CurrentTab>(() => {
    const override = new URLSearchParams(location.search).get("url");
    return override ? { url: override, clicked: true } : { clicked: false };
  });

  useEffect(() => {
    const chrome = getChrome();
    if (!chrome || new URLSearchParams(location.search).has("url")) return;
    let windowId: number | undefined;
    let activeTabId: number | undefined;
    let disposed = false;
    const refresh = async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const clicked = (await chrome.storage.session.get(CLICKED_TAB_KEY))[
        CLICKED_TAB_KEY
      ] as { tabId?: number; url?: string } | undefined;
      const routeKey = tab?.id === undefined ? "" : appTabRouteKey(tab.id);
      const route =
        tab?.url || !routeKey
          ? undefined
          : (await chrome.storage.session.get(routeKey))[routeKey];
      if (disposed) return;
      windowId = tab?.windowId;
      activeTabId = tab?.id;
      const fromClick =
        clicked?.tabId !== undefined && clicked.tabId === tab?.id;
      const url =
        tab?.url ??
        (fromClick ? clicked?.url : undefined) ??
        (typeof route === "string" ? chrome.runtime.getURL(route) : undefined);
      setCurrent((previous) =>
        previous.tabId === tab?.id &&
        previous.url === url &&
        previous.clicked === fromClick
          ? previous
          : { tabId: tab?.id, url, clicked: fromClick },
      );
    };
    const activated = (info: { windowId: number }) => {
      if (windowId === undefined || info.windowId === windowId) void refresh();
    };
    const updated = (
      tabId: number,
      change: { url?: string; status?: string },
    ) => {
      if (
        tabId === activeTabId &&
        (change.url !== undefined || change.status === "complete")
      )
        void refresh();
    };
    const stored = (changes: Record<string, unknown>, area: string) => {
      if (
        area === "session" &&
        (CLICKED_TAB_KEY in changes ||
          (activeTabId !== undefined && appTabRouteKey(activeTabId) in changes))
      )
        void refresh();
    };
    const access = () => void refresh();
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.storage.onChanged.addListener(stored);
    chrome.permissions.onAdded.addListener(access);
    chrome.permissions.onRemoved.addListener(access);
    void refresh();
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.storage.onChanged.removeListener(stored);
      chrome.permissions.onAdded.removeListener(access);
      chrome.permissions.onRemoved.removeListener(access);
    };
  }, []);

  return current;
}
