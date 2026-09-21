import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageKey } from "../../i18n";
import {
  clearCurrentSessionViewer,
  presentSessionViewer,
  setSessionViewerCloseAction,
  useSessionViewerController,
} from "../../lib/sessionViewerController";
import { SessionViewerToolbarController } from "../SessionViewerToolbarController";

/** Report the key and name chosen, so copy selection is what the test reads. */
const t = ((key: MessageKey, vars?: Record<string, string | number>) =>
  vars?.name === undefined ? key : `${key}:${vars.name}`) as Parameters<
  typeof SessionViewerToolbarController
>[0]["t"];

function Toolbar() {
  const controller = useSessionViewerController();
  return controller ? (
    <SessionViewerToolbarController controller={controller} t={t} />
  ) : null;
}

/** The trailing button, when the viewer offers one; the toggle always leads. */
const closeButton = () =>
  screen.queryAllByRole("button").at(1) as HTMLButtonElement | undefined;

describe("session viewer toolbar close action", () => {
  afterEach(() => {
    clearCurrentSessionViewer();
  });

  it("dismisses a file viewer through the default action", () => {
    const onClose = vi.fn();
    presentSessionViewer({
      id: "file:1",
      kind: "file",
      sessionId: "session-1",
      label: "notes.md",
      filePath: "/repo/notes.md",
      lineSuffix: "",
      onClose,
    });
    render(<Toolbar />);

    const close = closeButton();
    expect(close?.getAttribute("aria-label")).toBe("fileViewerClose:notes.md");
    expect(close?.disabled).toBe(false);
    fireEvent.click(close!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers no dismissal for a vhost until its owner installs one", () => {
    presentSessionViewer({
      id: "vhost:app",
      kind: "vhost",
      sessionId: "session-1",
      label: "plan",
      url: "http://localhost:19432/",
    });
    render(<Toolbar />);
    expect(closeButton()).toBeUndefined();

    const run = vi.fn();
    act(() =>
      setSessionViewerCloseAction("vhost:app", {
        label: "sessionRightPaneKill",
        destructive: true,
        run,
      }),
    );

    const close = closeButton();
    expect(close?.getAttribute("aria-label")).toBe("sessionRightPaneKill:plan");
    fireEvent.click(close!);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("disables a busy action so a second stop cannot be requested", () => {
    const run = vi.fn();
    presentSessionViewer({
      id: "vhost:busy",
      kind: "vhost",
      sessionId: "session-1",
      label: "plan",
      url: "http://localhost:19432/",
      closeAction: { label: "sessionRightPaneKill", busy: true, run },
    });
    render(<Toolbar />);

    const close = closeButton();
    expect(close?.disabled).toBe(true);
    fireEvent.click(close!);
    expect(run).not.toHaveBeenCalled();
  });
});
