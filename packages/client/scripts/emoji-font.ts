import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir, platform as osPlatform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Headless Chromium draws emoji only from a color emoji font installed on the
 * host, and Linux servers commonly ship none. YA's Emoji settings-icon style
 * and any emoji in a transcript then photograph as blank or monochrome boxes,
 * which reads as a UI defect rather than a missing font. Every capture flow
 * calls {@link ensureColorEmojiFont} before it launches a browser.
 *
 * Detection is local fontconfig, so a host that already has an emoji font
 * makes no network request at all. A host without one downloads the pinned
 * font once into a cache that outlives the run, installs it for the current
 * user, and is then detected locally forever after: the public server sees at
 * most one request per machine, not one per capture.
 */

export interface PinnedFont {
  /** Installed file name inside the user font directory. */
  name: string;
  /** Immutable commit URL, so the bytes cannot change under the digest. */
  url: string;
  bytes: number;
  sha256: string;
}

/** Pinned upstream file; the digest is checked before anything is installed. */
const FONT: PinnedFont = {
  name: "NotoColorEmoji.ttf",
  url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/f3ae03f5e9b3b8516fa151f7168159ca1a3e7515/fonts/NotoColorEmoji.ttf",
  bytes: 10673480,
  sha256: "72a635cb3d2f3524c51620cdde406b217204e8a6a06c6a096ff8ed4b5fd6e27b",
};

/** A capture is worth more than a fast font install; the download is bounded. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface EmojiFontResult {
  /** present: fontconfig already had one. installed: this call added it. */
  status: "present" | "installed" | "unavailable";
  detail: string;
}

export interface EmojiFontOptions {
  platform?: string;
  /** Session-stable download cache; a wiped font directory reuses it. */
  cacheDir?: string;
  /** User font directory fontconfig reads without root. */
  fontsDir?: string;
  fetchFont?: (font: PinnedFont) => Promise<Uint8Array>;
  listFonts?: () => Promise<string>;
  refreshFontCache?: (dir: string) => Promise<void>;
  /** The pin itself; tests substitute a small one they can produce. */
  font?: PinnedFont;
}

function xdgDir(variable: string, fallback: string[]): string {
  const configured = process.env[variable];
  return configured?.startsWith("/")
    ? configured
    : join(homedir(), ...fallback);
}

/** Families covering U+1F600, the grinning face every emoji font carries. */
async function listEmojiFonts(): Promise<string> {
  const { stdout } = await run("fc-list", [":charset=1F600", "family"]);
  return stdout.trim();
}

async function downloadFont(font: PinnedFont): Promise<Uint8Array> {
  const response = await fetch(font.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${font.url} responded ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function refreshFontCache(dir: string): Promise<void> {
  await run("fc-cache", ["-f", dir]);
}

async function cachedFont(
  cacheDir: string,
  font: PinnedFont,
  fetchFont: (font: PinnedFont) => Promise<Uint8Array>,
): Promise<string> {
  // Content-addressed, so a later pin caches beside this one rather than
  // colliding with it, and a truncated entry is never mistaken for the font.
  const path = join(cacheDir, `${font.name}.${font.sha256.slice(0, 12)}`);
  const cached = await stat(path).catch(() => null);
  if (cached?.isFile() && cached.size === font.bytes) return path;
  const bytes = await fetchFont(font);
  if (bytes.byteLength !== font.bytes)
    throw new Error(
      `expected ${font.bytes} bytes, received ${bytes.byteLength}`,
    );
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== font.sha256)
    throw new Error(`unexpected digest ${digest} for the pinned font`);
  await mkdir(cacheDir, { recursive: true });
  // Written aside and renamed so a concurrent capture never reads half a font.
  const staging = `${path}.${process.pid}`;
  await writeFile(staging, bytes);
  await rename(staging, path);
  return path;
}

/**
 * Make a color emoji font available to this host's browsers.
 *
 * Never throws: a capture that cannot install a font is still a capture, and
 * the caller reports the returned detail as a warning beside its images.
 */
export async function ensureColorEmojiFont(
  options: EmojiFontOptions = {},
): Promise<EmojiFontResult> {
  const platform = options.platform ?? osPlatform();
  if (platform !== "linux")
    return {
      status: "present",
      detail: `${platform} supplies a system color emoji font`,
    };
  const listFonts = options.listFonts ?? listEmojiFonts;
  const families = await listFonts().catch(() => null);
  if (families === null)
    return {
      status: "unavailable",
      detail: "fontconfig (fc-list) is not installed, so emoji may not render",
    };
  if (families)
    return {
      status: "present",
      detail: families.split("\n")[0] ?? "installed",
    };
  const cacheDir =
    options.cacheDir ??
    join(xdgDir("XDG_CACHE_HOME", [".cache"]), "yepanywhere", "fonts");
  const fontsDir =
    options.fontsDir ??
    join(xdgDir("XDG_DATA_HOME", [".local", "share"]), "fonts");
  const font = options.font ?? FONT;
  try {
    const source = await cachedFont(
      cacheDir,
      font,
      options.fetchFont ?? downloadFont,
    );
    await mkdir(fontsDir, { recursive: true });
    await copyFile(source, join(fontsDir, font.name));
    await (options.refreshFontCache ?? refreshFontCache)(fontsDir);
  } catch (error) {
    return {
      status: "unavailable",
      detail: `no color emoji font and installing one failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!(await listFonts().catch(() => "")))
    return {
      status: "unavailable",
      detail: `installed ${font.name} into ${fontsDir} but fontconfig still reports no emoji font`,
    };
  return {
    status: "installed",
    detail: `installed ${font.name} in ${fontsDir}`,
  };
}
