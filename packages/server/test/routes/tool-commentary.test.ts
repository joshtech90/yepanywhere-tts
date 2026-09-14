import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createToolCommentaryRoutes } from "../../src/routes/tool-commentary.js";

describe("tool commentary rendering", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ya-commentary-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true });
  });

  function routes() {
    const id = toUrlProjectId(directory);
    return {
      id,
      app: createToolCommentaryRoutes({
        scanner: {
          getProject: async (key: string) =>
            key === id ? { path: directory } : null,
        } as ProjectScanner,
      }),
    };
  }

  it("uses assistant Markdown for links, math, local media, and sanitization", async () => {
    await writeFile(join(directory, "report.md"), "# Report");
    const { id, app } = routes();
    const response = await app.request(`/${id}/tool-commentary/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: [
          "**Done** [report](./report.md) \\(x^2\\)",
          "<script>alert(1)</script>![plot](./plot.png)",
        ],
      }),
    });
    expect(response.status).toBe(200);
    const { html } = await response.json();
    expect(html[0]).toContain("<strong>Done</strong>");
    expect(html[0]).toContain("katex");
    expect(html[0]).toContain("report.md");
    expect(html[1]).not.toContain("<script>");
    expect(html[1]).toContain("plot.png");
  });

  it("rejects malformed and oversized requests", async () => {
    const { id, app } = routes();
    for (const body of [
      "{",
      JSON.stringify({ texts: [] }),
      JSON.stringify({ texts: Array(33).fill("text") }),
    ]) {
      expect(
        (
          await app.request(`/${id}/tool-commentary/render`, {
            method: "POST",
            body,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await app.request(`/${id}/tool-commentary/render`, {
          method: "POST",
          body: JSON.stringify({ texts: ["x".repeat(65536)] }),
        })
      ).status,
    ).toBe(413);
  });
});
