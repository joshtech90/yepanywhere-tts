// @vitest-environment node
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureColorEmojiFont } from "./emoji-font";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function workspace() {
  const base = await mkdtemp(join(tmpdir(), "emoji-font-"));
  directories.push(base);
  return { cacheDir: join(base, "cache"), fontsDir: join(base, "fonts") };
}

/** A stand-in for the real pin, small enough for a test to produce exactly. */
const BYTES = new Uint8Array([0x74, 0x74, 0x63, 0x66, 1, 2, 3, 4]);
const PIN = {
  name: "TestEmoji.ttf",
  url: "https://example.invalid/TestEmoji.ttf",
  bytes: BYTES.byteLength,
  sha256: createHash("sha256").update(BYTES).digest("hex"),
};
const CACHE_ENTRY = `${PIN.name}.${PIN.sha256.slice(0, 12)}`;

describe("ensureColorEmojiFont", () => {
  it("asks for nothing when fontconfig already has an emoji font", async () => {
    const fetchFont = vi.fn();
    const result = await ensureColorEmojiFont({
      platform: "linux",
      listFonts: async () => "Noto Color Emoji",
      fetchFont,
      ...(await workspace()),
    });
    expect(result.status).toBe("present");
    expect(fetchFont).not.toHaveBeenCalled();
  });

  it("reports the host rather than installing on macOS", async () => {
    const fetchFont = vi.fn();
    const result = await ensureColorEmojiFont({
      platform: "darwin",
      fetchFont,
    });
    expect(result.status).toBe("present");
    expect(fetchFont).not.toHaveBeenCalled();
  });

  it("says so when fontconfig itself is missing", async () => {
    const result = await ensureColorEmojiFont({
      platform: "linux",
      listFonts: async () => {
        throw new Error("spawn fc-list ENOENT");
      },
      fetchFont: async () => new Uint8Array(),
    });
    expect(result.status).toBe("unavailable");
    expect(result.detail).toContain("fc-list");
  });

  it("installs nothing when the download does not match the pin", async () => {
    const dirs = await workspace();
    const result = await ensureColorEmojiFont({
      platform: "linux",
      listFonts: async () => "",
      font: PIN,
      fetchFont: async () => new Uint8Array(PIN.bytes).fill(9),
      refreshFontCache: async () => {},
      ...dirs,
    });
    expect(result.status).toBe("unavailable");
    expect(result.detail).toContain("unexpected digest");
    expect(await readdir(dirs.fontsDir).catch(() => [])).toEqual([]);
  });

  it("downloads once, then serves later runs from the stable cache", async () => {
    const dirs = await workspace();
    const fetchFont = vi.fn(async () => BYTES);
    let installed = false;
    const options = {
      platform: "linux",
      // Empty until the font is installed, exactly as fontconfig behaves.
      listFonts: async () => (installed ? "Test Emoji" : ""),
      font: PIN,
      fetchFont,
      refreshFontCache: async () => {
        installed = true;
      },
      ...dirs,
    };
    const first = await ensureColorEmojiFont(options);
    expect(first.status).toBe("installed");
    expect(await readdir(dirs.fontsDir)).toEqual([PIN.name]);
    expect(await readdir(dirs.cacheDir)).toEqual([CACHE_ENTRY]);
    expect(fetchFont).toHaveBeenCalledTimes(1);

    // A wiped font directory reuses the cached download instead of the network.
    await rm(join(dirs.fontsDir, PIN.name));
    installed = false;
    const second = await ensureColorEmojiFont(options);
    expect(second.status).toBe("installed");
    expect(await readFile(join(dirs.fontsDir, PIN.name))).toEqual(
      Buffer.from(BYTES),
    );
    expect(fetchFont).toHaveBeenCalledTimes(1);
  });

  it("refetches a truncated cache entry instead of installing it", async () => {
    const dirs = await workspace();
    await mkdir(dirs.cacheDir, { recursive: true });
    await writeFile(join(dirs.cacheDir, CACHE_ENTRY), "partial");
    let installed = false;
    const fetchFont = vi.fn(async () => BYTES);
    const result = await ensureColorEmojiFont({
      platform: "linux",
      listFonts: async () => (installed ? "Test Emoji" : ""),
      font: PIN,
      fetchFont,
      refreshFontCache: async () => {
        installed = true;
      },
      ...dirs,
    });
    expect(result.status).toBe("installed");
    expect(fetchFont).toHaveBeenCalledTimes(1);
    expect(await readFile(join(dirs.fontsDir, PIN.name))).toEqual(
      Buffer.from(BYTES),
    );
  });
});
