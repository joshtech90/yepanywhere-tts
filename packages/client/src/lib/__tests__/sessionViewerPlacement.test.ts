import { describe, expect, it } from "vitest";
import type { SessionViewerControllerState } from "../sessionViewerController";
import { sessionViewerShowsBottomController } from "../sessionViewerPlacement";

function viewer(
  overrides: Partial<SessionViewerControllerState> & {
    kind: SessionViewerControllerState["kind"];
  },
): SessionViewerControllerState {
  return {
    id: "viewer",
    sessionId: "session",
    label: "index.html",
    close: () => {},
    minimize: () => {},
    restore: () => {},
    minimized: false,
    url: "http://app.localhost/",
    filePath: "index.html",
    lineSuffix: "",
    onClose: () => {},
    ...overrides,
  } as unknown as SessionViewerControllerState;
}

describe("sessionViewerShowsBottomController", () => {
  it("keeps the chip for an open covering viewer", () => {
    expect(sessionViewerShowsBottomController(viewer({ kind: "file" }))).toBe(
      true,
    );
  });

  it("hides the chip while a right-pane viewer is open", () => {
    // A vhost app always lives in the right pane regardless of the setting.
    expect(sessionViewerShowsBottomController(viewer({ kind: "vhost" }))).toBe(
      false,
    );
  });

  it("shows the chip once a right-pane viewer is minimized", () => {
    expect(
      sessionViewerShowsBottomController(
        viewer({ kind: "vhost", minimized: true }),
      ),
    ).toBe(true);
  });
});
