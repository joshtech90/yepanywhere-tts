import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { settingsDocHref, settingsDocLabel } from "../SettingsDocLink";

// The client package runner's working directory is packages/client.
const clientSrc = resolve(process.cwd(), "src");
const repoRoot = resolve(process.cwd(), "../..");

// `doc="topics/x.md"` and `doc={{ path: "topics/x.md", label: ... }}`.
const DOC_PATH_PATTERN = /\bdoc=(?:"([^"]+)"|\{\{\s*path:\s*"([^"]+)")/gu;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(full);
    }
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("settings documentation links", () => {
  it("point at documents that exist in the repository", () => {
    const missing: string[] = [];
    let linked = 0;
    for (const file of sourceFiles(clientSrc)) {
      for (const match of readFileSync(file, "utf8").matchAll(
        DOC_PATH_PATTERN,
      )) {
        const docPath = (match[1] ?? match[2] ?? "").split("#")[0] ?? "";
        linked += 1;
        if (!docPath.endsWith(".md") || !existsSync(join(repoRoot, docPath))) {
          missing.push(`${relative(repoRoot, file)}: ${docPath}`);
        }
      }
    }
    // A pattern that stopped matching would otherwise pass vacuously.
    expect(linked).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("names a document after its file and links the upstream copy", () => {
    expect(settingsDocLabel("topics/prompt-cache-keepalive.md#budget")).toBe(
      "prompt cache keepalive",
    );
    expect(settingsDocLabel({ path: "README.md", label: "Guide" })).toBe(
      "Guide",
    );
    expect(settingsDocHref("topics/recaps.md")).toBe(
      "https://github.com/kzahel/yepanywhere/blob/main/topics/recaps.md",
    );
  });
});
