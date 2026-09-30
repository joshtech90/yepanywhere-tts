import { act, cleanup, renderHook } from "@testing-library/react";
import type { PointerEvent } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useHeldSidebarLists } from "../useSidebarSessionOrder";

afterEach(cleanup);

const pointer = { pointerType: "mouse" } as PointerEvent<HTMLElement>;

describe("sidebar interaction before initial rows", () => {
  it("shows the first population under a stationary pointer, then preserves its order", () => {
    const { result, rerender } = renderHook(
      ({ rows }) => useHeldSidebarLists({ recent: rows }, true),
      { initialProps: { rows: [] as Array<{ id: string; title: string }> } },
    );
    act(() => result.current.handlers.onPointerEnter?.(pointer));
    rerender({
      rows: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    });
    expect(result.current.lists.recent.map(({ id }) => id)).toEqual(["a", "b"]);
    rerender({
      rows: [
        { id: "b", title: "New B" },
        { id: "c", title: "C" },
        { id: "a", title: "A" },
      ],
    });
    expect(result.current.lists.recent).toEqual([
      { id: "a", title: "A" },
      { id: "b", title: "New B" },
    ]);
    act(() => result.current.handlers.onPointerLeave?.(pointer));
    expect(result.current.lists.recent.map(({ id }) => id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("does not keep an empty hold after the interaction finishes before rows arrive", () => {
    const { result, rerender } = renderHook(
      ({ rows }) => useHeldSidebarLists({ recent: rows }, true),
      { initialProps: { rows: [] as Array<{ id: string }> } },
    );
    act(() => result.current.handlers.onPointerEnter?.(pointer));
    act(() => result.current.handlers.onPointerLeave?.(pointer));
    rerender({ rows: [{ id: "a" }] });
    rerender({ rows: [{ id: "b" }, { id: "a" }] });
    expect(result.current.lists.recent.map(({ id }) => id)).toEqual(["b", "a"]);
  });
});
