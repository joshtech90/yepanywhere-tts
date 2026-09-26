export const COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY =
  "yep-anywhere-cockpit-sidebar-width";

// The Cockpit runs on an 18.4px root font. Each row carries time and project
// columns beside the title, so the default leaves the title room to read.
export const COCKPIT_SIDEBAR_WIDTH_DEFAULT = 352;
export const COCKPIT_SIDEBAR_WIDTH_MIN = 240;
export const COCKPIT_SIDEBAR_WIDTH_MAX = 560;
export const COCKPIT_SIDEBAR_WIDTH_KEYBOARD_STEP = 16;
export const COCKPIT_SIDEBAR_WIDTH_KEYBOARD_BIG_STEP = 64;

export interface StoredCockpitSidebarWidth {
  version: 1;
  width: number;
}

export function clampCockpitSidebarWidth(
  value: number,
  viewportWidth?: number,
): number {
  if (!Number.isFinite(value)) {
    return COCKPIT_SIDEBAR_WIDTH_DEFAULT;
  }

  const rounded = Math.round(value);
  let maxAllowed = COCKPIT_SIDEBAR_WIDTH_MAX;

  if (typeof viewportWidth === "number" && Number.isFinite(viewportWidth)) {
    const viewportCap = Math.max(
      COCKPIT_SIDEBAR_WIDTH_MIN,
      Math.floor(viewportWidth * 0.5),
    );
    maxAllowed = Math.min(maxAllowed, viewportCap);
  }

  return Math.min(maxAllowed, Math.max(COCKPIT_SIDEBAR_WIDTH_MIN, rounded));
}

export function parseCockpitSidebarWidth(raw: string | null): number {
  if (!raw) return COCKPIT_SIDEBAR_WIDTH_DEFAULT;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredCockpitSidebarWidth>;
    if (
      parsed.version !== 1 ||
      typeof parsed.width !== "number" ||
      !Number.isFinite(parsed.width)
    ) {
      return COCKPIT_SIDEBAR_WIDTH_DEFAULT;
    }
    return clampCockpitSidebarWidth(parsed.width);
  } catch {
    return COCKPIT_SIDEBAR_WIDTH_DEFAULT;
  }
}

export function readCockpitSidebarWidth(
  storage: Pick<Storage, "getItem"> | null,
): number {
  try {
    return parseCockpitSidebarWidth(
      storage?.getItem(COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY) ?? null,
    );
  } catch {
    return COCKPIT_SIDEBAR_WIDTH_DEFAULT;
  }
}

export function saveCockpitSidebarWidth(
  storage: Pick<Storage, "setItem"> | null,
  width: number,
): void {
  try {
    const stored: StoredCockpitSidebarWidth = {
      version: 1,
      width: clampCockpitSidebarWidth(width),
    };
    storage?.setItem(
      COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY,
      JSON.stringify(stored),
    );
  } catch {
    // Private browsing and storage quotas must never break UI rendering.
  }
}

export function clearCockpitSidebarWidth(
  storage: Pick<Storage, "removeItem"> | null,
): void {
  try {
    storage?.removeItem(COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY);
  } catch {
    // Swallowed to remain resilient in restricted environments.
  }
}

export function nextCockpitSidebarWidthForKey(
  current: number,
  key: string,
  shiftKey: boolean,
  viewportWidth?: number,
): number | null {
  const step = shiftKey
    ? COCKPIT_SIDEBAR_WIDTH_KEYBOARD_BIG_STEP
    : COCKPIT_SIDEBAR_WIDTH_KEYBOARD_STEP;

  switch (key) {
    case "ArrowLeft":
      return clampCockpitSidebarWidth(current - step, viewportWidth);
    case "ArrowRight":
      return clampCockpitSidebarWidth(current + step, viewportWidth);
    case "Home":
      return clampCockpitSidebarWidth(COCKPIT_SIDEBAR_WIDTH_MIN, viewportWidth);
    case "End":
      return clampCockpitSidebarWidth(COCKPIT_SIDEBAR_WIDTH_MAX, viewportWidth);
    default:
      return null;
  }
}
