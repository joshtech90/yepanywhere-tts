import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COCKPIT_SIDEBAR_WIDTH_DEFAULT,
  COCKPIT_SIDEBAR_WIDTH_MAX,
  COCKPIT_SIDEBAR_WIDTH_MIN,
  COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY,
  readCockpitSidebarWidth,
} from "./core/sidebarWidth";
import { useCockpitSidebarWidth } from "./useCockpitSidebarWidth";

// jsdom has no PointerEvent, so pointerType and pointerId would be dropped.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

function TestSidebarHandle({
  enabled = true,
  label = "Resize sidebar",
}: {
  enabled?: boolean;
  label?: string;
}) {
  const { width, handleProps, style, resizing } = useCockpitSidebarWidth(
    enabled,
    label,
  );

  return (
    <div data-testid="container" style={style}>
      <span data-testid="width-display">{width}</span>
      <span data-testid="resizing-display">{String(resizing)}</span>
      {handleProps ? (
        <div data-testid="handle" {...handleProps} />
      ) : null}
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useCockpitSidebarWidth hook", () => {
  it("steps width via keyboard and saves immediately", () => {
    render(<TestSidebarHandle />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    expect(handle.getAttribute("aria-valuenow")).toBe("272");

    const defaultPrevented = !fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(defaultPrevented).toBe(true);
    expect(handle.getAttribute("aria-valuenow")).toBe("288");
    expect(readCockpitSidebarWidth(localStorage)).toBe(288);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle.getAttribute("aria-valuenow")).toBe("272");
    expect(readCockpitSidebarWidth(localStorage)).toBe(272);

    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(handle.getAttribute("aria-valuenow")).toBe("336");
    expect(readCockpitSidebarWidth(localStorage)).toBe(336);

    const ignoredPrevented = !fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(ignoredPrevented).toBe(false);
  });

  it("handles Home and End keys directly to boundaries", () => {
    render(<TestSidebarHandle />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe(
      String(COCKPIT_SIDEBAR_WIDTH_MIN),
    );
    expect(readCockpitSidebarWidth(localStorage)).toBe(
      COCKPIT_SIDEBAR_WIDTH_MIN,
    );

    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe(
      String(COCKPIT_SIDEBAR_WIDTH_MAX),
    );
    expect(readCockpitSidebarWidth(localStorage)).toBe(
      COCKPIT_SIDEBAR_WIDTH_MAX,
    );
  });

  it("resets to default and clears storage on double click", () => {
    localStorage.setItem(
      COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY,
      JSON.stringify({ version: 1, width: 360 }),
    );

    render(<TestSidebarHandle />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(handle.getAttribute("aria-valuenow")).toBe("360");

    fireEvent.doubleClick(handle);
    expect(handle.getAttribute("aria-valuenow")).toBe(
      String(COCKPIT_SIDEBAR_WIDTH_DEFAULT),
    );
    expect(localStorage.getItem(COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
  });

  it("drags with synchronous rAF and commits to storage on pointerup only", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    render(<TestSidebarHandle />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    expect(localStorage.getItem(COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();

    fireEvent.pointerDown(handle, {
      clientX: 272,
      pointerId: 1,
      button: 0,
    });

    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(handle.getAttribute("data-resizing")).toBe("true");

    fireEvent.pointerMove(handle, {
      clientX: 320,
      pointerId: 1,
    });

    expect(handle.getAttribute("aria-valuenow")).toBe("320");
    expect(localStorage.getItem(COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();

    fireEvent.pointerUp(handle, {
      clientX: 320,
      pointerId: 1,
    });

    expect(handle.getAttribute("aria-valuenow")).toBe("320");
    expect(handle.getAttribute("data-resizing")).toBe("false");
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
    expect(readCockpitSidebarWidth(localStorage)).toBe(320);
  });

  it("does not crash when localStorage.getItem throws", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Storage blocked");
      });

    let renderedResult:
      | ReturnType<
          typeof renderHook<
            ReturnType<typeof useCockpitSidebarWidth>,
            [boolean]
          >
        >["result"]
      | undefined;

    expect(() => {
      const rendered = renderHook(() => useCockpitSidebarWidth(true));
      renderedResult = rendered.result;
    }).not.toThrow();

    expect(renderedResult?.current.width).toBe(COCKPIT_SIDEBAR_WIDTH_DEFAULT);
    getItemSpy.mockRestore();
  });

  it("returns null handleProps and empty style when disabled", () => {
    const { result } = renderHook(() => useCockpitSidebarWidth(false));

    expect(result.current.handleProps).toBeNull();
    expect(result.current.style).toEqual({});
    expect(result.current.resizing).toBe(false);
    expect(result.current.width).toBe(COCKPIT_SIDEBAR_WIDTH_DEFAULT);
  });

  it("re-clamps width on window resize without saving to storage", () => {
    localStorage.setItem(
      COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY,
      JSON.stringify({ version: 1, width: 440 }),
    );

    render(<TestSidebarHandle />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(handle.getAttribute("aria-valuenow")).toBe("440");

    const originalWidth = window.innerWidth;
    window.innerWidth = 600;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    window.innerWidth = originalWidth;

    // 50% of 600 is 300, capping width to 300
    expect(handle.getAttribute("aria-valuenow")).toBe("300");
    expect(readCockpitSidebarWidth(localStorage)).toBe(440);
  });
});
