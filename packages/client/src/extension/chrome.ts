/**
 * The Chrome extension APIs YA's extension code uses (docs/tactical/151).
 *
 * Declared here rather than through `@types/chrome` so the client keeps one
 * small, reviewed surface and no global `chrome` type leaks into web code.
 * Every function is the promise form Manifest V3 provides.
 */

export interface ChromeTab {
  id?: number;
  windowId: number;
  url?: string;
  active: boolean;
  index?: number;
  pinned?: boolean;
  lastAccessed?: number;
}

export interface ChromeWindow {
  id?: number;
  type?: string;
  focused?: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  tabs?: ChromeTab[];
}

interface ChromeEvent<Listener> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
}

export interface ChromeStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface ChromeStorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface ChromeMessageSender {
  tab?: ChromeTab;
  url?: string;
}

export interface ChromeApi {
  runtime: {
    id: string;
    reload(): void;
    getManifest(): Record<string, unknown>;
    getURL(path: string): string;
    getContexts(filter: { contextTypes: string[] }): Promise<
      {
        contextType: string;
        documentUrl?: string;
        frameId: number;
        tabId: number;
        windowId: number;
      }[]
    >;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: ChromeEvent<
      (
        message: unknown,
        sender: ChromeMessageSender,
        respond: (response: unknown) => void,
      ) => unknown
    >;
    onInstalled: ChromeEvent<() => void>;
    onStartup: ChromeEvent<() => void>;
    openOptionsPage(): Promise<void>;
  };
  storage: {
    local: ChromeStorageArea;
    session: ChromeStorageArea;
    onChanged: ChromeEvent<
      (changes: Record<string, ChromeStorageChange>, area: string) => void
    >;
  };
  tabs: {
    query(info: {
      active?: boolean;
      currentWindow?: boolean;
      lastFocusedWindow?: boolean;
      url?: string | string[];
    }): Promise<ChromeTab[]>;
    get(tabId: number): Promise<ChromeTab>;
    getCurrent(): Promise<ChromeTab | undefined>;
    create(info: {
      url: string;
      active?: boolean;
      windowId?: number;
      index?: number;
      pinned?: boolean;
    }): Promise<ChromeTab>;
    update(
      tabId: number,
      info: { active?: boolean; url?: string; pinned?: boolean },
    ): Promise<ChromeTab>;
    onActivated: ChromeEvent<
      (info: { tabId: number; windowId: number }) => void
    >;
    onUpdated: ChromeEvent<
      (
        tabId: number,
        change: { url?: string; status?: string },
        tab: ChromeTab,
      ) => void
    >;
    onRemoved: ChromeEvent<(tabId: number) => void>;
  };
  windows: {
    create(info: {
      url: string;
      type?: "normal" | "popup";
      focused?: boolean;
      left?: number;
      top?: number;
      width?: number;
      height?: number;
    }): Promise<ChromeWindow>;
    getCurrent(): Promise<ChromeWindow>;
    get(windowId: number): Promise<ChromeWindow>;
    update(windowId: number, info: { focused?: boolean }): Promise<unknown>;
    WINDOW_ID_CURRENT: number;
  };
  action: {
    setTitle(details: { title: string }): Promise<void>;
    setBadgeText(details: { tabId?: number; text: string }): Promise<void>;
    setBadgeBackgroundColor(details: {
      tabId?: number;
      color: string;
    }): Promise<void>;
    onClicked: ChromeEvent<(tab: ChromeTab) => void>;
  };
  contextMenus: {
    create(properties: {
      id: string;
      title: string;
      contexts: "action"[];
      visible?: boolean;
    }): void;
    update(id: string, properties: { visible?: boolean }): Promise<void>;
    removeAll(): Promise<void>;
    onClicked: ChromeEvent<
      (info: { menuItemId: string | number }, tab?: ChromeTab) => void
    >;
  };
  sidePanel: {
    open(options: { tabId?: number; windowId?: number }): Promise<void>;
    setPanelBehavior(behavior: {
      openPanelOnActionClick: boolean;
    }): Promise<void>;
  };
  permissions: {
    getAll(): Promise<{ origins?: string[]; permissions?: string[] }>;
    contains(request: { origins: string[] }): Promise<boolean>;
    request(request: { origins: string[] }): Promise<boolean>;
    remove(request: { origins: string[] }): Promise<boolean>;
    onAdded: ChromeEvent<(permissions: { origins?: string[] }) => void>;
    onRemoved: ChromeEvent<(permissions: { origins?: string[] }) => void>;
  };
}

/** The extension API, or null outside an extension page or worker. */
export function getChrome(): ChromeApi | null {
  const candidate = (globalThis as { chrome?: Partial<ChromeApi> }).chrome;
  return candidate?.runtime?.id ? (candidate as ChromeApi) : null;
}

/** True in a page served from this extension's own origin. */
export function isExtensionPage(): boolean {
  return (
    typeof location !== "undefined" &&
    location.protocol === "chrome-extension:" &&
    getChrome() !== null
  );
}
