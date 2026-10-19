/**
 * Passive evidence for gaps/prose-font-lost-until-reload.md: the chosen prose
 * font sometimes falls back until a reload. Records a bundled font face that
 * fails to load and a lost prose-font custom property, the two candidate
 * causes. Silent unless one happens. Remove when that gap closes.
 */
import { clientLogCollector } from "./index";

const MAX_EVENTS = 50;
const PROSE_FONT_PROPERTY = "--output-prose-font-family";

export function installFontDiagnostics(): void {
  if (!document.fonts) return;
  const events: string[] = [];
  // Readable from a live window's console or a debugger attached to it.
  (window as { __yaFontDiagnostics?: string[] }).__yaFontDiagnostics = events;
  const note = (message: string) => {
    events.push(`${new Date().toISOString()} ${message}`);
    if (events.length > MAX_EVENTS) events.shift();
    // Not the console: this is evidence for a gap, not an actionable warning.
    clientLogCollector.record("warn", "[FontLoad]", message);
  };
  document.fonts.addEventListener("loadingerror", (event) => {
    for (const face of event.fontfaces)
      note(
        `failed face "${face.family}" style=${face.style} weight=${face.weight} status=${face.status}`,
      );
  });
  const root = document.documentElement;
  let prose = root.style.getPropertyValue(PROSE_FONT_PROPERTY);
  new MutationObserver(() => {
    const next = root.style.getPropertyValue(PROSE_FONT_PROPERTY);
    if (next === prose) return;
    note(`prose font property changed from "${prose}" to "${next}"`);
    prose = next;
  }).observe(root, { attributes: true, attributeFilter: ["style"] });
}
