import { createDocumentFinder } from "@yep-anywhere/shared/find/documentFind";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// jsdom has no layout: give ranges the empty box a real browser would
// report for off-screen text, so revealing a match takes its fallback path.
beforeAll(() => {
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function selected(): string {
  return document.getSelection()?.toString() ?? "";
}

describe("createDocumentFinder", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.getSelection()?.removeAllRanges();
  });

  it("counts matches within its root only, smart-case", () => {
    mount("<p>Alpha outside</p>");
    const root = mount("<p>alpha Alpha</p><p>ALPHA beta</p>");
    const finder = createDocumentFinder(root);
    expect(finder.find("alpha")).toEqual({
      total: 3,
      current: 1,
      capped: false,
    });
    // An uppercase letter makes the search case-sensitive, as in isearch.
    expect(finder.find("Alpha").total).toBe(1);
  });

  it("matches across inline markup and any whitespace, not across blocks", () => {
    const root = mount(
      "<p>find <b>this</b>\n   text</p><p>end</p><p>of line</p>",
    );
    const finder = createDocumentFinder(root);
    expect(finder.find("find this text").total).toBe(1);
    expect(selected()).toBe("find this\n   text");
    expect(finder.find("endof").total).toBe(0);
  });

  it("keeps its place while the query grows, and steps with wrap-around", () => {
    const root = mount("<p>cat car cart cat</p>");
    const finder = createDocumentFinder(root);
    expect(finder.find("ca").total).toBe(4);
    expect(finder.step(1).current).toBe(2);
    // "car" still matches at the current place, so isearch stays there.
    expect(finder.find("car")).toMatchObject({ total: 2, current: 1 });
    expect(finder.find("cart")).toMatchObject({ total: 1, current: 1 });
    expect(selected()).toBe("cart");
    expect(finder.find("ca").current).toBe(3);
    expect(finder.step(1).current).toBe(4);
    expect(finder.step(1).current).toBe(1);
    expect(finder.step(-1).current).toBe(4);
  });

  it("ignores script and style text and clears its selection", () => {
    const root = mount(
      "<style>.needle{}</style><script>needle()</script><p>needle</p>",
    );
    const finder = createDocumentFinder(root);
    expect(finder.find("needle").total).toBe(1);
    finder.clear();
    expect(selected()).toBe("");
    expect(finder.find("   ")).toEqual({
      total: 0,
      current: 0,
      capped: false,
    });
  });

  it("scrolls the vertical scroller past a sideways-only one inside it", () => {
    // The file viewer's shape: a body scrolling vertically around a Markdown
    // preview that scrolls only sideways because a table is wider than it.
    const body = mount(
      '<div><table><tr><td id="cell">needle</td></tr></table></div>',
    );
    const preview = body.firstElementChild as HTMLElement;
    for (const element of [body, preview]) {
      element.style.overflowX = "auto";
      element.style.overflowY = "auto";
    }
    const layout = (
      element: HTMLElement,
      size: { scrollHeight: number; clientHeight: number; scrollWidth: number },
    ) => {
      for (const [key, value] of Object.entries({ clientWidth: 800, ...size }))
        Object.defineProperty(element, key, { configurable: true, value });
      // jsdom ignores scroll writes; keep them so the layout can follow.
      for (const key of ["scrollTop", "scrollLeft"])
        Object.defineProperty(element, key, { writable: true, value: 0 });
    };
    layout(body, { scrollHeight: 15000, clientHeight: 600, scrollWidth: 800 });
    layout(preview, {
      scrollHeight: 15000,
      clientHeight: 15000,
      scrollWidth: 1300,
    });
    const box = (top: number, height: number, left = 0, width = 800) =>
      new DOMRect(left, top, width, height);
    body.getBoundingClientRect = () => box(0, 600);
    preview.getBoundingClientRect = () => box(-body.scrollTop, 15000);
    const matchTop = 5000;
    const rangeBox = vi
      .spyOn(Range.prototype, "getBoundingClientRect")
      .mockImplementation(() => box(matchTop - body.scrollTop, 20, 100, 60));
    try {
      expect(createDocumentFinder(body).find("needle").total).toBe(1);
      expect(body.scrollTop).toBe(matchTop + 10 - 300);
      expect(preview.scrollLeft).toBe(0);
    } finally {
      rangeBox.mockRestore();
    }
  });
});
