import { readFileSync } from "node:fs";

/**
 * Collect Groq keys from inline values and key files. Each source may hold
 * several keys separated by commas or newlines; `#` lines are comments.
 * Missing or unreadable files are skipped so one absent pool file on a host
 * does not disable the others.
 */
export function loadGroqApiKeys(
  inline: string | undefined,
  files: readonly string[] = [],
): string[] {
  const keys: string[] = [];
  const add = (text: string) => {
    for (const raw of text.split(/[\n,]/)) {
      const key = raw.trim();
      if (key && !key.startsWith("#") && !keys.includes(key)) keys.push(key);
    }
  };
  if (inline) add(inline);
  for (const file of files) {
    try {
      add(readFileSync(file, "utf8"));
    } catch {
      // Absent on this host; the remaining sources still count.
    }
  }
  return keys;
}
