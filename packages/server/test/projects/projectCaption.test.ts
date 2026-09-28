import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearProjectCaptionCache,
  deriveProjectCaption,
  extractManifestCaption,
  extractReadmeCaption,
  fitCaption,
  getDerivedProjectCaption,
} from "../../src/projects/projectCaption.js";

const SENTENCE =
  "A complete browser interface for Claude Code and Codex that runs anywhere.";

describe("extractReadmeCaption", () => {
  it("skips a short title heading and takes the first sentence paragraph", () => {
    expect(
      extractReadmeCaption(`# yepanywhere\n\n${SENTENCE}\nSecond line.\n`),
    ).toBe(`${SENTENCE} Second line.`);
  });

  it("accepts a heading when it is sentence length", () => {
    expect(extractReadmeCaption(`# ${SENTENCE}\n\nshort\n`)).toBe(SENTENCE);
  });

  it("skips HTML blocks, badge lines, comments, code, and front matter", () => {
    const readme = [
      "---",
      "title: x",
      "---",
      '<p align="center"><em>Mobile-first. End-to-end encrypted. Open source.</em></p>',
      "",
      "[![CI](https://x/badge.svg)](https://x) ![npm](https://x/npm.svg)",
      "",
      "<!-- Replace this comment with one or two sentences describing the",
      "project; YA shows the first real paragraph as the caption. -->",
      "",
      "```sh",
      "npm install something that is long enough to look like a sentence here",
      "```",
      "",
      `${SENTENCE}`,
      "",
    ].join("\n");
    expect(extractReadmeCaption(readme)).toBe(SENTENCE);
  });

  it("strips inline markdown and skips lists and tables", () => {
    const readme = [
      "- a list item that is certainly long enough to be a sentence here",
      "",
      "| col | that is long enough to be a sentence when joined together |",
      "",
      "**Bold** start, a [link](https://x) and `code` in a sentence long enough.",
    ].join("\n");
    expect(extractReadmeCaption(readme)).toBe(
      "Bold start, a link and code in a sentence long enough.",
    );
  });

  it("returns undefined when nothing is sentence length", () => {
    expect(extractReadmeCaption("# tiny\n\nshort words\n")).toBeUndefined();
  });
});

describe("extractManifestCaption", () => {
  it("reads package.json, pyproject.toml, and Cargo.toml descriptions", () => {
    expect(
      extractManifestCaption(
        "package.json",
        JSON.stringify({ description: "  A  package. " }),
      ),
    ).toBe("A package.");
    expect(
      extractManifestCaption(
        "pyproject.toml",
        '[build-system]\ndescription = "no"\n[project]\nname = "x"\ndescription = "A Python thing"\n',
      ),
    ).toBe("A Python thing");
    expect(
      extractManifestCaption(
        "Cargo.toml",
        '[package]\ndescription = "A Rust \\"thing\\""\n',
      ),
    ).toBe('A Rust "thing"');
    expect(extractManifestCaption("package.json", "{not json")).toBeUndefined();
  });
});

describe("fitCaption", () => {
  it("prefers a sentence boundary before the limit", () => {
    const first = `${"word ".repeat(40).trim()}.`;
    const fitted = fitCaption(`${first} ${"more ".repeat(60)}`);
    expect(fitted).toBe(first);
  });

  it("falls back to a word boundary with an ellipsis", () => {
    const fitted = fitCaption("x".repeat(100).concat(" ", "y".repeat(400)));
    expect(fitted).toBe(`${"x".repeat(100)}…`);
  });
});

describe("deriveProjectCaption", () => {
  let dir: string;
  afterEach(async () => {
    clearProjectCaptionCache();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("prefers README over a manifest and reports the source", async () => {
    dir = await mkdtemp(join(tmpdir(), "caption-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ description: "manifest text" }),
    );
    expect(await deriveProjectCaption(dir)).toEqual({
      text: "manifest text",
      source: "manifest",
    });
    await writeFile(join(dir, "readme.md"), `# t\n\n${SENTENCE}\n`);
    expect(await deriveProjectCaption(dir)).toEqual({
      text: SENTENCE,
      source: "readme",
    });
  });

  it("shows a caption written into a placeholder README on the next read", async () => {
    dir = await mkdtemp(join(tmpdir(), "caption-"));
    expect(await getDerivedProjectCaption(dir)).toBeUndefined();
    const readme = join(dir, "README.md");
    await writeFile(readme, "# t\n\n<!-- Describe this project here. -->\n");
    expect(await getDerivedProjectCaption(dir)).toBeUndefined();
    await writeFile(readme, `# t\n\n${SENTENCE}\n`);
    expect(await getDerivedProjectCaption(dir)).toEqual({
      text: SENTENCE,
      source: "readme",
    });
  });

  it("reuses a cached caption while its inputs are unchanged", async () => {
    dir = await mkdtemp(join(tmpdir(), "caption-"));
    const readme = join(dir, "README.md");
    await writeFile(readme, `${SENTENCE}\n`);
    const expected = { text: SENTENCE, source: "readme" };
    expect(await getDerivedProjectCaption(dir)).toEqual(expected);
    // An unreadable README would derive nothing; the cache must not reread it.
    await chmod(readme, 0o000);
    try {
      expect(await getDerivedProjectCaption(dir)).toEqual(expected);
    } finally {
      await chmod(readme, 0o644);
    }
  });

  it("returns undefined for a missing directory", async () => {
    dir = join(tmpdir(), "caption-missing-dir");
    expect(await deriveProjectCaption(dir)).toBeUndefined();
  });
});
