import { describe, expect, it } from "vitest";
import { createScriptlessHtmlPreviewDocument } from "../scriptlessHtmlPreview";

function preview(body: string): Document {
  return new DOMParser().parseFromString(
    createScriptlessHtmlPreviewDocument(`<html><body>${body}</body></html>`),
    "text/html",
  );
}

describe("Pandoc math in the scriptless preview", () => {
  it("typesets delimited inline and display math as MathML", () => {
    const doc = preview(
      '<p><span class="math inline">\\(\\mathrm{WER}_E\\)</span></p>' +
        '<p><span class="math display">\\[\\epsilon = 0.1\\]</span></p>',
    );
    const [inline, display] = doc.querySelectorAll("span.math math");
    expect(inline?.getAttribute("display")).not.toBe("block");
    expect(inline?.querySelector("annotation")?.textContent).toBe(
      "\\mathrm{WER}_E",
    );
    expect(display?.getAttribute("display")).toBe("block");
    expect(doc.body.textContent).not.toContain("\\(");
  });

  it("keeps the authored source when KaTeX cannot render it", () => {
    const doc = preview(
      '<span class="math inline">\\(\\authormacro{x}\\)</span>',
    );
    expect(doc.querySelector("math")).toBeNull();
    expect(doc.body.textContent).toBe("\\(\\authormacro{x}\\)");
  });
});
