/**
 * Derive a project caption from files inside the project directory.
 *
 * Order: the first sentence-length paragraph or heading of the README, else
 * the description field of a known manifest. Results are cached in server
 * memory for a day so listing projects never rescans directories. See
 * topics/project-captions.md for the contract.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  MAX_PROJECT_CAPTION_LENGTH,
  type ProjectCaption,
} from "@yep-anywhere/shared";

const README_PATTERN = /^readme(\.(md|markdown|txt))?$/i;
const MIN_CAPTION_WORDS = 6;
const MIN_CAPTION_CHARS = 40;
const MAX_README_BYTES = 64 * 1024;
export const PROJECT_CAPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface ManifestReader {
  file: string;
  read(content: string): string | undefined;
}

const MANIFESTS: readonly ManifestReader[] = [
  {
    file: "package.json",
    read(content) {
      try {
        const parsed = JSON.parse(content) as { description?: unknown };
        return typeof parsed.description === "string"
          ? parsed.description
          : undefined;
      } catch {
        return undefined;
      }
    },
  },
  {
    file: "pyproject.toml",
    read: (content) => tomlSectionString(content, "project", "description"),
  },
  {
    file: "Cargo.toml",
    read: (content) => tomlSectionString(content, "package", "description"),
  },
];

/** Read `key = "value"` from one `[section]` of a TOML file, without a parser. */
function tomlSectionString(
  content: string,
  section: string,
  key: string,
): string | undefined {
  let inSection = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inSection = line === `[${section}]`;
      continue;
    }
    if (!inSection) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== key) continue;
    const value = (match[2] ?? "").trim();
    const quoted =
      /^"((?:[^"\\]|\\.)*)"/.exec(value) ?? /^'([^']*)'/.exec(value);
    return quoted?.[1] === undefined
      ? undefined
      : quoted[1].replace(/\\"/g, '"');
  }
  return undefined;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

function isSentenceLength(text: string): boolean {
  return (
    text.length >= MIN_CAPTION_CHARS &&
    text.split(" ").filter(Boolean).length >= MIN_CAPTION_WORDS
  );
}

function looksLikeHtml(block: string): boolean {
  return /<\/?[a-zA-Z][^>]*>/.test(block);
}

function isBadgeOnly(block: string): boolean {
  const withoutLinks = block
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return withoutLinks.length === 0;
}

/**
 * Split README text into blocks: headings, paragraphs, and skipped regions
 * (front matter, fenced code, HTML). Returns the first sentence-length block.
 */
export function extractReadmeCaption(markdown: string): string | undefined {
  // Drop a leading byte-order mark (U+FEFF) without embedding the character.
  let text = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  if (/^---\r?\n/.test(text)) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) text = text.slice(end + 4);
  }

  const lines = text.split(/\r?\n/);
  let fence: string | null = null;
  let inComment = false;
  let block: string[] = [];

  const flush = (): string | undefined => {
    if (block.length === 0) return undefined;
    const raw = block.join("\n");
    block = [];
    if (looksLikeHtml(raw) || isBadgeOnly(raw)) return undefined;
    const candidate = stripInlineMarkdown(
      raw
        .split("\n")
        .map((line) =>
          line.replace(/^\s*(>\s?)+/, "").replace(/^\s*#{1,6}\s+/, ""),
        )
        .join(" "),
    );
    if (/^[-*+]\s|^\d+\.\s|^\|/.test(raw.trim())) return undefined;
    return isSentenceLength(candidate) ? candidate : undefined;
  };

  for (const line of lines) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (fence === null) {
        const found = flush();
        if (found) return found;
        fence = fenceMatch[1] ?? "```";
      } else if (line.trim().startsWith(fence)) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;

    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (/^\s*<!--/.test(line)) {
      const found = flush();
      if (found) return found;
      inComment = !line.includes("-->");
      continue;
    }

    if (line.trim() === "") {
      const found = flush();
      if (found) return found;
      continue;
    }
    if (/^\s*#{1,6}\s+/.test(line)) {
      // A heading is its own block; a long enough one can be the caption.
      const found = flush();
      if (found) return found;
      block = [line];
      const heading = flush();
      if (heading) return heading;
      continue;
    }
    block.push(line);
  }
  return flush();
}

/** Trim to the caption limit, preferring a sentence boundary. */
export function fitCaption(text: string): string {
  if (text.length <= MAX_PROJECT_CAPTION_LENGTH) return text;
  const limit = text.slice(0, MAX_PROJECT_CAPTION_LENGTH);
  const sentenceEnd = Math.max(
    limit.lastIndexOf(". "),
    limit.lastIndexOf("! "),
    limit.lastIndexOf("? "),
  );
  if (sentenceEnd >= MIN_CAPTION_CHARS) return limit.slice(0, sentenceEnd + 1);
  const wordEnd = limit.lastIndexOf(" ");
  return `${limit.slice(0, wordEnd > 0 ? wordEnd : limit.length).trimEnd()}…`;
}

export function extractManifestCaption(
  fileName: string,
  content: string,
): string | undefined {
  const reader = MANIFESTS.find((manifest) => manifest.file === fileName);
  const value = reader?.read(content)?.replace(/\s+/g, " ").trim();
  return value ? fitCaption(value) : undefined;
}

async function readIfPresent(filePath: string): Promise<string | undefined> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const { size } = await handle.stat();
      const buffer = Buffer.alloc(Math.min(size, MAX_README_BYTES));
      await handle.read(buffer, 0, buffer.length, 0);
      return buffer.toString("utf-8");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

/** Uncached derivation: README first, then manifests in a fixed order. */
export async function deriveProjectCaption(
  projectPath: string,
): Promise<ProjectCaption | undefined> {
  let entries: string[];
  try {
    entries = await fs.readdir(projectPath);
  } catch {
    return undefined;
  }
  const readmeName = entries
    .filter((entry) => README_PATTERN.test(entry))
    .sort((a, b) => a.localeCompare(b))[0];
  if (readmeName) {
    const content = await readIfPresent(path.join(projectPath, readmeName));
    const text = content ? extractReadmeCaption(content) : undefined;
    if (text) return { text: fitCaption(text), source: "readme" };
  }
  for (const manifest of MANIFESTS) {
    if (!entries.includes(manifest.file)) continue;
    const content = await readIfPresent(path.join(projectPath, manifest.file));
    const text = content
      ? extractManifestCaption(manifest.file, content)
      : undefined;
    if (text) return { text, source: "manifest" };
  }
  return undefined;
}

interface CachedCaption {
  caption: ProjectCaption | undefined;
  expiresAt: number;
}

const cache = new Map<string, CachedCaption>();

/** Cached derivation, one directory scan per project per day. */
export async function getDerivedProjectCaption(
  projectPath: string,
  now = Date.now(),
): Promise<ProjectCaption | undefined> {
  const cached = cache.get(projectPath);
  if (cached && cached.expiresAt > now) return cached.caption;
  const caption = await deriveProjectCaption(projectPath);
  cache.set(projectPath, {
    caption,
    expiresAt: now + PROJECT_CAPTION_CACHE_TTL_MS,
  });
  return caption;
}

export function clearProjectCaptionCache(projectPath?: string): void {
  if (projectPath === undefined) cache.clear();
  else cache.delete(projectPath);
}
