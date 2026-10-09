import { generateUUID } from "./uuid";

// The key predates its second reader; keeping it keeps existing tabs' ids.
const TAB_ID_STORAGE_KEY = "ya:browser-debug-tab-id";
let unstoredTabId: string | undefined;

/**
 * This tab's identity, stable across reloads and distinct from other tabs.
 * Without session storage it lasts only for this page load.
 */
export function browserTabId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = generateUUID();
    sessionStorage.setItem(TAB_ID_STORAGE_KEY, created);
    return created;
  } catch {
    unstoredTabId ??= generateUUID();
    return unstoredTabId;
  }
}

/** A coarse device label from the user agent, such as "Mac" or "Android". */
export function browserDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Browser";
}
