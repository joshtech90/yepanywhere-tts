import type { CockpitTranscriptEntry } from "./sessionDetail";

/**
 * Sent to the current session so its own agent writes the handoff; it knows
 * the work better than any outside summary.
 */
export const COCKPIT_HANDOFF_PROMPT = [
  "Fasse den aktuellen Arbeitsstand dieser Sitzung als Übergabe an eine neue Sitzung zusammen.",
  "Die neue Sitzung kennt diesen Verlauf nicht. Schreibe nur die Übergabe, stelle keine Rückfragen und arbeite nicht weiter.",
  "",
  "Gliederung:",
  "1. Ziel und Auftrag",
  "2. Erledigt (mit Dateien, Befehlen, Commits)",
  "3. Aktueller Stand und offene Punkte",
  "4. Wichtige Entscheidungen, Regeln und Fallen",
  "5. Der nächste konkrete Schritt",
  "",
  "Knapp, vollständig, auf Deutsch.",
].join("\n");

/** Lines a stop hook or reply convention appends that do not belong in it. */
const TRAILER = /^\s*(\*\*Next step:\*\*|Orchestrierung:)/i;

function assistantText(entry: CockpitTranscriptEntry): string {
  if (entry.kind !== "assistant") return "";
  return entry.text
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The finished answer to the handoff prompt: the last assistant text after the
 * latest user entry carrying the prompt. Null while it is missing or still
 * streaming.
 */
export function extractCockpitHandoffSummary(
  entries: readonly CockpitTranscriptEntry[],
  prompt: string = COCKPIT_HANDOFF_PROMPT,
): string | null {
  let start = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === "user" && entry.text.trim() === prompt.trim()) {
      start = index;
      break;
    }
  }
  if (start < 0) return null;
  for (let index = entries.length - 1; index > start; index -= 1) {
    const entry = entries[index];
    if (entry?.kind !== "assistant") continue;
    if (entry.isStreaming) return null;
    const text = assistantText(entry)
      .split("\n")
      .filter((line) => !TRAILER.test(line))
      .join("\n")
      .trim();
    if (text) return text;
  }
  return null;
}

/** First message of the new session: context, the handoff, and the ask. */
export function buildCockpitHandoffMessage(input: {
  summary: string;
  sourceTitle: string;
}): string {
  return [
    `Übernimm die Arbeit aus der vorherigen Sitzung „${input.sourceTitle}“. Hier ist ihre Übergabe:`,
    "",
    input.summary.trim(),
    "",
    "Prüfe den Stand kurz und fahre dann mit dem nächsten Schritt fort.",
  ].join("\n");
}
