import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();
vi.mock("../../api/projectApp", () => ({
  projectAppApi: { info: (id: string) => info(id) },
}));

import { useProjectAppUpdates } from "../useProjectAppUpdates";

const declaration = { version: 1 };
const app = (updatedAt?: string, state = "ready") => ({
  declaration,
  state,
  ...(updatedAt ? { updatedAt } : {}),
});
const noApp = { declaration: null, state: "none" };

beforeEach(() => info.mockReset());
afterEach(cleanup);

function run(turnActive: boolean, onUpdated = vi.fn(), open = false) {
  const hook = renderHook(
    ({ active, open }) =>
      useProjectAppUpdates("p1", true, active, open, onUpdated),
    { initialProps: { active: turnActive, open } },
  );
  return { ...hook, onUpdated };
}

describe("useProjectAppUpdates", () => {
  it("reports a declared app and opens it when a turn rebuilds it", async () => {
    info.mockResolvedValue(app("t1"));
    const { result, rerender, onUpdated } = run(false);
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ active: true, open: false });
    await waitFor(() => expect(info).toHaveBeenCalledTimes(2));
    info.mockResolvedValue(app("t2"));
    rerender({ active: false, open: false });
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it("leaves the app closed after a turn that did not change it", async () => {
    info.mockResolvedValue(app("t1"));
    const { rerender, onUpdated } = run(false);
    await waitFor(() => expect(info).toHaveBeenCalledTimes(1));
    rerender({ active: true, open: false });
    await waitFor(() => expect(info).toHaveBeenCalledTimes(2));
    rerender({ active: false, open: false });
    await waitFor(() => expect(info).toHaveBeenCalledTimes(3));
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("opens an app the turn declared for the first time, once it is built", async () => {
    info.mockResolvedValue(noApp);
    const { result, rerender, onUpdated } = run(true);
    await waitFor(() => expect(info).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);

    // Declared without a build: nothing to show yet.
    info.mockResolvedValue(app(undefined, "missing"));
    rerender({ active: false, open: false });
    await waitFor(() => expect(result.current).toBe(true));
    expect(onUpdated).not.toHaveBeenCalled();

    rerender({ active: true, open: false });
    await waitFor(() => expect(info).toHaveBeenCalledTimes(3));
    info.mockResolvedValue(app());
    rerender({ active: false, open: false });
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  // An open app unmounting at a turn boundary took its keyboard focus
  // (an `app.json` mid-edit reads as no declaration).
  it("keeps an open app through a turn-boundary reading without a declaration", async () => {
    info.mockResolvedValue(app("t1"));
    const { result, rerender } = run(false, vi.fn(), true);
    await waitFor(() => expect(result.current).toBe(true));

    info.mockResolvedValue(noApp);
    rerender({ active: true, open: true });
    await waitFor(() => expect(info).toHaveBeenCalledTimes(2));
    rerender({ active: false, open: true });
    await waitFor(() => expect(info).toHaveBeenCalledTimes(3));
    await act(() => Promise.resolve());
    expect(result.current).toBe(true);

    // Once closed, the removal the readings reported takes effect.
    rerender({ active: false, open: false });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
