/**
 * A second Cockpit on another machine that this one offers to switch to.
 *
 * The deployment names it in `cockpit-peer.json` next to the built client
 * (written per machine by the release script, like its icons). Without that
 * file there is no peer and no switch button, so a plain install looks as
 * before.
 */
export interface CockpitPeer {
  /** Short machine name shown on the button, e.g. "aihub". */
  label: string;
  /** Absolute address of the other Cockpit. */
  url: string;
  /** The other machine's app icon, shown on the button. */
  icon: string;
}

export const COCKPIT_PEER_PATH = "/cockpit-peer.json";

const MAX_LABEL_LENGTH = 24;

function webUrl(value: unknown, base?: string): URL | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Accepts only a complete, web-addressed peer; anything else means none. */
export function parseCockpitPeer(
  raw: unknown,
  currentOrigin?: string,
): CockpitPeer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const label =
    typeof record.label === "string" ? record.label.trim() : undefined;
  if (!label || label.length > MAX_LABEL_LENGTH) return null;
  const url = webUrl(record.url);
  if (!url) return null;
  // A peer pointing back at this very Cockpit would be a button to nowhere.
  if (currentOrigin && url.origin === currentOrigin) return null;
  // The other machine serves its own icon; a relative path resolves there.
  const icon = webUrl(record.icon ?? "/icon-192.png", url.href);
  if (!icon) return null;
  return { label, url: url.href, icon: icon.href };
}
