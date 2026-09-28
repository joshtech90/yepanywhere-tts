// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSearchMatchHighlight } from "./useSearchMatchHighlight";

function mountRow() {
  const scrollport = document.createElement("div");
  const row = document.createElement("div");
  row.textContent = "The specimen is ready.";
  scrollport.append(row);
  document.body.append(scrollport);
  return { row, scrollport };
}

describe("useSearchMatchHighlight", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("does not let a reveal begun before the reader's key repaint after it", () => {
    const { result } = renderHook(() => useSearchMatchHighlight(false));
    const { row, scrollport } = mountRow();

    act(() => {
      result.current.beginSearchMatchReveal()(row, scrollport, "ready", false);
      result.current.releaseSearchMatchHighlightOnInput();
    });
    expect(row.dataset.searchMatch).toBe("true");

    // The committed jump's settle reveal is still waiting on its scroll when
    // the reader presses a key and dismisses the landing.
    const lateReveal = result.current.beginSearchMatchReveal();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    expect(row.dataset.searchMatch).toBeUndefined();

    lateReveal(row, scrollport, "ready", false);
    expect(row.dataset.searchMatch).toBeUndefined();

    // A reveal begun after the clear still highlights normally.
    result.current.beginSearchMatchReveal()(row, scrollport, "ready", false);
    expect(row.dataset.searchMatch).toBe("true");
  });
});
