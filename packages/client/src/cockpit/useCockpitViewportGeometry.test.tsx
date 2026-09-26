import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCockpitViewportGeometry } from "./useCockpitViewportGeometry";

const originalInnerHeight = Object.getOwnPropertyDescriptor(
  window,
  "innerHeight",
);
const originalVisualViewport = Object.getOwnPropertyDescriptor(
  window,
  "visualViewport",
);

function Fixture() {
  const viewport = useCockpitViewportGeometry();
  return (
    <main
      data-keyboard={viewport.keyboardOpen ? "open" : "closed"}
      style={viewport.style}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalVisualViewport) {
    Object.defineProperty(window, "visualViewport", originalVisualViewport);
  } else {
    Reflect.deleteProperty(window, "visualViewport");
  }
  if (originalInnerHeight) {
    Object.defineProperty(window, "innerHeight", originalInnerHeight);
  } else {
    Reflect.deleteProperty(window, "innerHeight");
  }
});

describe("Cockpit visual viewport geometry", () => {
  it("does not mistake the initial mobile browser viewport for an open keyboard", () => {
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { configurable: true, value: 669 },
      offsetTop: { configurable: true, value: 0 },
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport as VisualViewport,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 812,
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const view = render(<Fixture />);
    const root = view.container.querySelector("main");

    expect(root?.style.getPropertyValue("--cockpit-viewport-height")).toBe(
      "812px",
    );
    expect(root?.getAttribute("data-keyboard")).toBe("closed");
  });

  it("tracks an Android/iOS-like keyboard resize without document geometry", () => {
    let height = 780;
    let offsetTop = 0;
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { configurable: true, get: () => height },
      offsetTop: { configurable: true, get: () => offsetTop },
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport as VisualViewport,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 812,
    });
    let scheduledFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const view = render(<Fixture />);
    act(() => scheduledFrame?.(0));
    const root = view.container.querySelector("main");
    expect(root?.style.getPropertyValue("--cockpit-viewport-height")).toBe(
      "780px",
    );
    expect(root?.getAttribute("data-keyboard")).toBe("closed");

    height = 500;
    offsetTop = 12;
    act(() => {
      viewport.dispatchEvent(new Event("resize"));
      scheduledFrame?.(1);
    });

    expect(root?.style.getPropertyValue("--cockpit-viewport-height")).toBe(
      "500px",
    );
    expect(root?.style.getPropertyValue("--cockpit-viewport-offset-top")).toBe(
      "12px",
    );
    expect(root?.getAttribute("data-keyboard")).toBe("open");
  });
});
