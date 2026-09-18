import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalBackGesture } from "../Modal";

function Harness({ onClose }: { onClose?: () => void }) {
  useModalBackGesture(onClose ?? (() => {}), true, "__testModal");
  return null;
}

/** Navigate the way FileResourceActions does: a new URL, same state object. */
function navigateInTab(url: string): void {
  window.history.pushState(window.history.state, "", url);
}

describe("useModalBackGesture", () => {
  let backSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.replaceState(null, "", "/projects/p/sessions/s");
    backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
  });

  afterEach(() => {
    backSpy.mockRestore();
  });

  it("drops its history entry when the modal closes in place", async () => {
    const view = render(<Harness />);
    view.unmount();
    await Promise.resolve();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves a navigation alone when the modal unmounts because of it", async () => {
    const view = render(<Harness />);
    navigateInTab("/new-session?projectId=p");
    view.unmount();
    await Promise.resolve();
    expect(backSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/new-session");
  });
});
