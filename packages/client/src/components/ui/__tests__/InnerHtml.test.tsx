import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setInnerHtmlIfChanged } from "../../../lib/setInnerHtmlIfChanged";
import { InnerHtml } from "../InnerHtml";

describe("InnerHtml", () => {
  it("keeps its nodes when a re-render brings the same markup", () => {
    const { container, rerender } = render(
      <InnerHtml trustedHtml="<p>Reply <strong>one</strong></p>" />,
    );
    const paragraph = container.querySelector("p");
    rerender(
      <InnerHtml
        className="changed"
        trustedHtml="<p>Reply <strong>one</strong></p>"
      />,
    );
    expect(container.querySelector("p")).toBe(paragraph);

    rerender(<InnerHtml trustedHtml="<p>Reply two</p>" />);
    expect(container.querySelector("p")).not.toBe(paragraph);
    expect(container.textContent).toBe("Reply two");
  });
});

describe("setInnerHtmlIfChanged", () => {
  it("rewrites an element only when the markup differs", () => {
    const element = document.createElement("div");
    setInnerHtmlIfChanged(element, "<p>same</p>");
    const paragraph = element.firstChild;
    setInnerHtmlIfChanged(element, "<p>same</p>");
    expect(element.firstChild).toBe(paragraph);
    setInnerHtmlIfChanged(element, "<p>next</p>");
    expect(element.firstChild).not.toBe(paragraph);
  });
});

describe("dangerouslySetInnerHTML call sites", () => {
  // React 19 rewrites innerHTML whenever the `{ __html }` object is new, so an
  // inline literal rebuilds the DOM on every render and drops a reader's drag
  // selection. Use InnerHtml, useInnerHtml, or a module-level constant.
  it("never pass an inline object literal", () => {
    const root = resolve(process.cwd(), "src");
    const offenders: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") visit(path);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          if (/dangerouslySetInnerHTML=\{\{/.test(readFileSync(path, "utf8"))) {
            offenders.push(relative(root, path));
          }
        }
      }
    };
    visit(root);
    expect(offenders).toEqual([]);
  });
});
