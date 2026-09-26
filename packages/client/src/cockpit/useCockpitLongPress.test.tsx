import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCockpitLongPress } from "./useCockpitLongPress";

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

afterEach(cleanup);

function TestComponent({
  onLongPress,
  delayMs,
  onClick,
}: {
  onLongPress: (point: { x: number; y: number }) => void;
  delayMs?: number;
  onClick?: () => void;
}) {
  const handlers = useCockpitLongPress(onLongPress, delayMs);
  return (
    <button type="button" data-testid="target" {...handlers} onClick={onClick}>
      Press target
    </button>
  );
}

describe("useCockpitLongPress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("touch press 500ms fires once", () => {
    const onLongPress = vi.fn();
    render(<TestComponent onLongPress={onLongPress} />);
    const target = screen.getByTestId("target");

    fireEvent.pointerDown(target, {
      pointerType: "touch",
      clientX: 50,
      clientY: 60,
    });
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith({ x: 50, y: 60 });

    vi.advanceTimersByTime(1000);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("cancels when finger moves > 10px", () => {
    const onLongPress = vi.fn();
    render(<TestComponent onLongPress={onLongPress} />);
    const target = screen.getByTestId("target");

    fireEvent.pointerDown(target, {
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });

    // Move 6px: gesture remains active
    fireEvent.pointerMove(target, {
      pointerType: "touch",
      clientX: 106,
      clientY: 100,
    });
    vi.advanceTimersByTime(200);

    // Move > 10px total distance from origin: gesture cancels
    fireEvent.pointerMove(target, {
      pointerType: "touch",
      clientX: 112,
      clientY: 100,
    });

    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("mouse pointer never fires", () => {
    const onLongPress = vi.fn();
    render(<TestComponent onLongPress={onLongPress} />);
    const target = screen.getByTestId("target");

    fireEvent.pointerDown(target, {
      pointerType: "mouse",
      clientX: 50,
      clientY: 50,
    });
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("swallows click after long press", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<TestComponent onLongPress={onLongPress} onClick={onClick} />);
    const target = screen.getByTestId("target");

    fireEvent.pointerDown(target, {
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(target, {
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });

    const clickAllowed = fireEvent.click(target);
    expect(clickAllowed).toBe(false);
    expect(onClick).not.toHaveBeenCalled();

    // Subsequent regular click operates normally
    fireEvent.click(target);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("pen pointer type also fires long press", () => {
    const onLongPress = vi.fn();
    render(<TestComponent onLongPress={onLongPress} />);
    const target = screen.getByTestId("target");

    fireEvent.pointerDown(target, {
      pointerType: "pen",
      clientX: 75,
      clientY: 85,
    });
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith({ x: 75, y: 85 });
  });

  it("cleans timers on unmount", () => {
    const onLongPress = vi.fn();
    const { unmount } = render(<TestComponent onLongPress={onLongPress} />);
    const target = screen.getByTestId("target");

    fireEvent.pointerDown(target, {
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    unmount();

    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("calls navigator.vibrate if available and ignores vibration failures", () => {
    const vibrateSpy = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateSpy,
      configurable: true,
      writable: true,
    });

    const onLongPress = vi.fn();
    render(<TestComponent onLongPress={onLongPress} />);
    const target = screen.getByTestId("target");

    fireEvent.pointerDown(target, {
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    vi.advanceTimersByTime(500);
    expect(vibrateSpy).toHaveBeenCalledWith(10);

    Object.defineProperty(navigator, "vibrate", {
      value: () => {
        throw new Error("Denied");
      },
      configurable: true,
      writable: true,
    });

    fireEvent.pointerDown(target, {
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    expect(() => {
      vi.advanceTimersByTime(500);
    }).not.toThrow();
  });
});
