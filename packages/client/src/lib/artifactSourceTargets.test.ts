import { describe, expect, it } from "vitest";
import {
  artifactTargetPath,
  createArtifactEditDocument,
  prepareArtifactEditPreview,
} from "./artifactSourceTargets";

function parse(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("artifact source targets", () => {
  const html = `<!--# sourceMappingURL=maps/paper.html.map -->
<!-- ya-source-target:v1 {"id":"paragraph","source":"../../sections/intro.qmd","sourceRange":[[4,0],[7,0]]} -->
<p>Same words. <em>Different word</em></p>
<!-- /ya-source-target:v1 paragraph -->`;
  it("maps rendered paragraphs to original file ranges with sidecar-relative paths", () => {
    const result = prepareArtifactEditPreview(html, "n1");
    expect(result.targets[0]?.sourceRange[0]).toEqual([4, 0]);
    expect(
      parse(result.snapshot)
        .querySelector("p")
        ?.getAttribute("data-ya-edit-target"),
    ).toBe("paragraph");
    expect(artifactTargetPath(result.targets[0]!.source, result.mapUrl)).toBe(
      "maps/../../sections/intro.qmd",
    );
  });
  it("ignores comment-like text in scripts and rejects malformed pairs", () => {
    expect(
      prepareArtifactEditPreview(
        `<script>const s = ${JSON.stringify(html)}</script>`,
        "n1",
      ).targets,
    ).toEqual([]);
    expect(() =>
      prepareArtifactEditPreview(
        html.replace(
          "/ya-source-target:v1 paragraph",
          "/ya-source-target:v1 wrong",
        ),
        "n1",
      ),
    ).toThrow("Unmatched");
    expect(() => prepareArtifactEditPreview(html + html, "n1")).toThrow();
  });
  it("keeps ordinary HTML editable without mappings and strips active content from selection view", () => {
    const result = prepareArtifactEditPreview(
      '<p onclick="alert(1)">Plain</p><script>evil()</script><iframe src="/api"></iframe><div data-ya-edit-target="x">Spoof</div>',
      "testnonce",
    );
    expect(result.targets).toEqual([]);
    const output = createArtifactEditDocument(result);
    expect(output).not.toContain("evil()");
    expect(output).not.toContain("onclick=");
    expect(output).not.toContain("<iframe");
    expect(output).not.toContain('data-ya-edit-target="x"');
    expect(output).toContain("script-src 'nonce-testnonce'");
    expect(output).toContain("ya-source-target");
  });
  it("derives every selection view from one prepared snapshot without a document", () => {
    const prepared = prepareArtifactEditPreview(html, "n1");
    // Plain data: nothing retains the parsed document or the producer HTML.
    expect(JSON.parse(JSON.stringify(prepared))).toEqual(prepared);
    const views = [
      createArtifactEditDocument(prepared),
      createArtifactEditDocument(
        prepared,
        "https://artifacts.example.org/a/t/paper.html?x=1&y=2",
      ),
    ];
    for (const view of views) {
      const head = parse(view).head;
      expect(head.firstElementChild?.getAttribute("http-equiv")).toBe(
        "Content-Security-Policy",
      );
      expect(view).not.toContain("ya-edit-policy-");
      expect(view).not.toContain("ya-edit-base-");
      expect(
        parse(view).querySelector("p")?.getAttribute("data-ya-edit-target"),
      ).toBe("paragraph");
    }
    expect(views[0]).not.toContain("<base");
    expect(views[0]).toContain("base-uri 'none'");
    expect(parse(views[1]!).querySelector("base")?.getAttribute("href")).toBe(
      "https://artifacts.example.org/a/t/paper.html?x=1&y=2",
    );
    expect(views[1]).toContain(
      "img-src data: blob: https://artifacts.example.org",
    );
  });
});
