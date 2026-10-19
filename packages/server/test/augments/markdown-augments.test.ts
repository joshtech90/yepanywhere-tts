import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectPathIndex } from "../../src/projects/projectPathIndex.js";
import {
  __test__,
  augmentTextBlocks,
  markdownAugmentCacheDiagnostics,
  renderMarkdownToHtml,
} from "../../src/augments/markdown-augments.js";
import {
  HighlightWorkerUnavailableError,
  highlightWorker,
} from "../../src/highlighting/highlight-worker-host.js";
import type { ProjectPathIndex } from "../../src/projects/projectPathIndex.js";
import { compileTranscriptProjection } from "@yep-anywhere/shared/transcript/compiler";
import type { Message } from "@yep-anywhere/shared/transcript/message";

afterEach(() => {
  __test__.resetMarkdownHtmlCache();
  vi.restoreAllMocks();
});

describe("assistant markdown augments", () => {
  it("renders compact summary prose safely and keeps provider metadata separate", async () => {
    const summary =
      '### Active task\n\n- Keep **Markdown** readable.\n\n<script>alert("summary")</script>';
    const message: Message = {
      uuid: "compact",
      type: "system",
      subtype: "compact_boundary",
      content: "Context compacted",
      compactSummaryText: summary,
      compactMetadata: { trigger: "auto" },
    };
    const original = compileTranscriptProjection([message]);
    await augmentTextBlocks([message]);
    const projected = compileTranscriptProjection([message]);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      type: "system",
      subtype: "compact_boundary",
      details: [
        [{ type: "text", text: summary, _html: expect.any(String) }],
        'compactMetadata:\n{\n  "trigger": "auto"\n}',
      ],
    });
    expect(message._html).toContain("<h3");
    expect(message._html).toContain("<ul>");
    expect(message._html).toContain("<strong>Markdown</strong>");
    expect(message._html).not.toContain("<script>");
    expect(original[0]).toMatchObject({
      details: [summary, expect.any(String)],
    });
    expect(projected[0]).not.toHaveProperty("detailsOpen", true);
  });

  it("resolves filenames from preceding directories across a prose body", async () => {
    const root = await mkdtemp(join(tmpdir(), "ya-mentioned-directories-"));
    const index = await getProjectPathIndex(root);
    try {
      await mkdir(join(root, "ar/raghda"), { recursive: true });
      await mkdir(join(root, "other"));
      for (const path of [
        "README.md",
        "ar/raghda/README.md",
        "ar/raghda/onboard.py",
        "ar/raghda/score.sh",
        "other/README.md",
      ]) {
        await writeFile(join(root, path), "fixture");
      }
      const html = await renderMarkdownToHtml(
        "README.md first. Use `ar/raghda/` as the template; it already has its recording, intake (onboard.py) and scoring (score.sh).\n\nRead `README.md`, then missing/ and README.md. In `other/`, read README.md and ./README.md.\n\n[README.md](https://example.com)\n\n```text\nar/raghda/ README.md\n```",
        {
          projectFileLinks: { projectId: "project", projectPath: root, index },
        },
      );
      expect(
        [...html.matchAll(/data-ya-directory-file="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      ).toEqual([
        "ar/raghda/onboard.py",
        "ar/raghda/score.sh",
        "ar/raghda/README.md",
        "ar/raghda/README.md",
        "other/README.md",
      ]);
      const next = await renderMarkdownToHtml("README.md", {
        projectFileLinks: { projectId: "project", projectPath: root, index },
      });
      expect(next).not.toContain("data-ya-directory-file");
    } finally {
      index.release();
      await rm(root, { recursive: true });
    }
  });

  it("retains immutable HTML and joins concurrent duplicate renders", async () => {
    const first = renderMarkdownToHtml("Shared **body**.");
    const second = renderMarkdownToHtml("Shared **body**.");

    expect(await first).toBe(await second);
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      joinedCalls: 1,
      retainedEntries: 1,
      staleCompletions: 0,
      unretainedCompletions: 0,
      workStarts: 1,
    });

    await renderMarkdownToHtml("Shared **body**.");
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      cacheHits: 1,
      retainedEntries: 1,
      workStarts: 1,
    });
  });

  it("does not retain plain fallbacks for a temporarily unavailable highlighter", async () => {
    const markdown = "```python\nx = 1\n```";
    vi.spyOn(highlightWorker, "highlight").mockRejectedValueOnce(
      new HighlightWorkerUnavailableError("Highlight worker stalled"),
    );
    const fallback = await renderMarkdownToHtml(markdown);
    expect(fallback).not.toContain("var(--shiki-");
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      retainedEntries: 0,
      unretainedCompletions: 1,
    });

    const highlighted = await renderMarkdownToHtml(markdown);
    expect(highlighted).toContain("var(--shiki-");
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      retainedEntries: 1,
      workStarts: 2,
    });
  });

  it("keeps Quarto-aware renders separate in the Markdown cache", async () => {
    const markdown = "{{< include sections/_methods.qmd >}}";
    const ordinary = await renderMarkdownToHtml(markdown, {
      localFileBasePath: "/workspace/project",
    });
    const quarto = await renderMarkdownToHtml(markdown, {
      localFileBasePath: "/workspace/project",
      quartoMarkdown: true,
    });

    expect(ordinary).not.toContain("data-ya-resource");
    expect(quarto).toContain(
      'href="/api/local-file?path=%2Fworkspace%2Fproject%2Fsections%2F_methods.qmd&amp;render=1"',
    );
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      retainedEntries: 2,
      workStarts: 2,
    });
  });

  it("joins but does not retain unversioned filesystem answers", async () => {
    const index: ProjectPathIndex = {
      findExisting: async (paths) => new Set(paths),
      has: async () => true,
      knownFile: () => undefined,
      release: () => undefined,
      sourceRevision: () => 1,
    };
    const options = {
      projectFileLinks: {
        projectId: "project-1",
        projectPath: "/workspace/project",
        index,
      },
    };

    const first = renderMarkdownToHtml("See `src/server.ts`.", options);
    const second = renderMarkdownToHtml("See `src/server.ts`.", options);
    await Promise.all([first, second]);
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      joinedCalls: 1,
      retainedEntries: 0,
      unretainedCompletions: 1,
      workStarts: 1,
    });

    await renderMarkdownToHtml("See `src/server.ts`.", options);
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      retainedEntries: 0,
      unretainedCompletions: 2,
      workStarts: 2,
    });
  });

  it("coalesces but does not retain inline local-image output", async () => {
    const options = {
      inlineLocalImages: true,
      localFileBasePath: "/workspace/project",
    };

    const first = renderMarkdownToHtml("Shared **body**.", options);
    const second = renderMarkdownToHtml("Shared **body**.", options);
    await Promise.all([first, second]);
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      joinedCalls: 1,
      retainedEntries: 0,
      unretainedCompletions: 1,
      workStarts: 1,
    });

    await renderMarkdownToHtml("Shared **body**.", options);
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      retainedEntries: 0,
      unretainedCompletions: 2,
      workStarts: 2,
    });
  });

  it("recomputes retained HTML after the path membership revision changes", async () => {
    let revision = 1;
    let exists = true;
    const index: ProjectPathIndex = {
      findExisting: async (paths) => new Set(exists ? paths : []),
      has: async () => exists,
      knownFile: () => exists,
      release: () => undefined,
      sourceRevision: () => revision,
    };
    const options = {
      projectFileLinks: {
        projectId: "project-1",
        projectPath: "/workspace/project",
        index,
      },
    };

    expect(
      await renderMarkdownToHtml("See `src/server.ts`.", options),
    ).toContain('data-ya-resource="local-file"');
    revision += 1;
    exists = false;
    expect(
      await renderMarkdownToHtml("See `src/server.ts`.", options),
    ).not.toContain('data-ya-resource="local-file"');
    expect(markdownAugmentCacheDiagnostics()).toMatchObject({
      cacheHits: 0,
      retainedEntries: 1,
      workStarts: 2,
    });
  });

  it("renders bracket-delimited inline and display math through katex", async () => {
    const text = String.raw`
For each token \(t\), it formed only a local emission score:

\[
e_t(y)=(Wh_t+b)_y
\]
`;
    const block: { _html?: string; text: string; type: "text" } = {
      text,
      type: "text",
    };
    const messages = [
      {
        type: "assistant",
        message: { content: [block] },
      },
    ];

    await augmentTextBlocks(messages);

    expect(block._html?.match(/class="katex"/g)).toHaveLength(2);
    expect(block._html).toContain('class="katex-display"');
    expect(block._html).toContain('class="msupsub"');
  });

  it("links bare project paths in turn prose and skips ordinary words", async () => {
    const batches: string[][] = [];
    const files = new Set(["src/server.ts", "Makefile"]);
    const index: ProjectPathIndex = {
      findExisting: async (paths: readonly string[]) => {
        batches.push([...paths]);
        return new Set(paths.filter((path) => files.has(path)));
      },
      has: async (path: string) => files.has(path),
      // Stands in for a listed root, which is what lets an extensionless name
      // be answered without spending a lookup on it.
      knownFile: (path: string) => files.has(path),
      release: () => undefined,
      sourceRevision: () => 1,
    };
    const block: { _html?: string; text: string; type: "text" } = {
      text: "Edited src/server.ts and the Makefile; runs/absent.json is gone. See [src/server.ts](https://example.com/x) upstream.",
      type: "text",
    };

    await augmentTextBlocks(
      [{ type: "assistant", message: { content: [block] } }],
      {
        projectFileLinks: {
          projectId: "project-1",
          projectPath: "/workspace/project",
          index,
        },
      },
    );

    const html = block._html ?? "";
    expect(html).toContain('data-ya-resource="local-file"');
    expect(html).toContain("/workspace/project/src/server.ts");
    expect(html).toContain("/workspace/project/Makefile");
    expect(html).not.toContain("runs/absent.json</a>");
    // The markdown link's anchor text is a real path; rewriting it would nest
    // an anchor inside an anchor.
    expect(html).toContain('href="https://example.com/x"');
    expect(html).not.toMatch(/<a[^>]*>[^<]*<a /);
    // One batched pre-resolve pass, and `Makefile` never entered it.
    expect(batches[0]).toEqual(["src/server.ts", "runs/absent.json"]);
  });
});
