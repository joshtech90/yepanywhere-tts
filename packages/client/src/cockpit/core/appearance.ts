export const COCKPIT_APPEARANCE_STORAGE_KEY = "yep-anywhere-cockpit-appearance";

export const COCKPIT_THEMES = ["auto", "light", "dark"] as const;
export const COCKPIT_ACCENTS = ["blue", "violet", "teal", "coral"] as const;

export type CockpitTheme = (typeof COCKPIT_THEMES)[number];
export type CockpitResolvedTheme = Exclude<CockpitTheme, "auto">;
export type CockpitAccent = (typeof COCKPIT_ACCENTS)[number];

export interface CockpitAppearance {
  theme: CockpitTheme;
  accent: CockpitAccent;
}

interface StoredCockpitAppearance extends CockpitAppearance {
  version: 1;
}

export const DEFAULT_COCKPIT_APPEARANCE: CockpitAppearance = {
  theme: "auto",
  accent: "blue",
};

function includesValue<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function parseCockpitAppearance(
  raw: string | null,
): CockpitAppearance {
  if (!raw) return DEFAULT_COCKPIT_APPEARANCE;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredCockpitAppearance>;
    if (
      parsed.version !== 1 ||
      !includesValue(COCKPIT_THEMES, parsed.theme) ||
      !includesValue(COCKPIT_ACCENTS, parsed.accent)
    ) {
      return DEFAULT_COCKPIT_APPEARANCE;
    }
    return { theme: parsed.theme, accent: parsed.accent };
  } catch {
    return DEFAULT_COCKPIT_APPEARANCE;
  }
}

export function readCockpitAppearance(
  storage: Pick<Storage, "getItem"> | null,
): CockpitAppearance {
  try {
    return parseCockpitAppearance(
      storage?.getItem(COCKPIT_APPEARANCE_STORAGE_KEY) ?? null,
    );
  } catch {
    return DEFAULT_COCKPIT_APPEARANCE;
  }
}

export function saveCockpitAppearance(
  storage: Pick<Storage, "setItem"> | null,
  appearance: CockpitAppearance,
): void {
  try {
    const stored: StoredCockpitAppearance = { version: 1, ...appearance };
    storage?.setItem(COCKPIT_APPEARANCE_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private browsing and full storage must not make the Cockpit unusable.
  }
}

export function resolveCockpitTheme(
  theme: CockpitTheme,
  prefersDark: boolean,
): CockpitResolvedTheme {
  if (theme === "auto") return prefersDark ? "dark" : "light";
  return theme;
}
