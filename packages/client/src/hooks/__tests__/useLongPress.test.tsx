import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLongPress } from "../useLongPress";

function Probe({
  onClick,
  onLongPress,
}: {
  onClick: () => void;
  onLongPress: () => void;
}) {
  const press = useLongPress(onLongPress);
  return (
    <button type="button" {...press.handlers} onClick={press.click(onClick)}>
      App
    </button>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const onClick = vi.fn();
  const onLongPress = vi.fn();
  render(<Probe onClick={onClick} onLongPress={onLongPress} />);
  return { onClick, onLongPress, button: screen.getByRole("button") };
}

it("runs the long press after a held press and swallows its click", () => {
  const { onClick, onLongPress, button } = setup();
  fireEvent.pointerDown(button, { button: 0, clientX: 5, clientY: 5 });
  vi.advanceTimersByTime(600);
  expect(onLongPress).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(button);
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
  // The next ordinary tap clicks again.
  fireEvent.pointerDown(button, { button: 0 });
  fireEvent.pointerUp(button);
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("treats a press the browser hands to scrolling as not held", () => {
  const { onClick, onLongPress, button } = setup();
  fireEvent.pointerDown(button, { button: 0 });
  // A touch that becomes a scroll ends in pointercancel.
  fireEvent.pointerCancel(button);
  vi.advanceTimersByTime(600);
  expect(onLongPress).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("runs the long press on right-click", () => {
  const { onLongPress, button } = setup();
  fireEvent.contextMenu(button);
  expect(onLongPress).toHaveBeenCalledTimes(1);
});
