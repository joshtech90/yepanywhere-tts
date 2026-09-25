import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CockpitAttachmentDropCue,
  useCockpitAttachmentDropTarget,
} from "./CockpitAttachmentDropTarget";

afterEach(cleanup);

describe("Cockpit attachment drop target", () => {
  function Target({ onFiles }: { onFiles: (files: File[]) => void }) {
    const dropTarget = useCockpitAttachmentDropTarget(onFiles);
    return (
      <div {...dropTarget.handlers}>
        <textarea aria-label="Message" />
        <CockpitAttachmentDropCue
          label="Drop files to attach"
          visible={dropTarget.draggingFiles}
        />
      </div>
    );
  }

  it("hands pasted files to the existing attachment pipeline", () => {
    const onFiles = vi.fn();
    render(<Target onFiles={onFiles} />);
    const file = new File(["invented"], "notes.txt", {
      type: "text/plain",
    });

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        items: [{ getAsFile: () => file, kind: "file" }],
      },
    });

    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("leaves ordinary text paste to the textarea", () => {
    const onFiles = vi.fn();
    render(<Target onFiles={onFiles} />);

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        items: [{ getAsFile: () => null, kind: "string" }],
      },
    });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("shows a drop cue and accepts dragged files", () => {
    const onFiles = vi.fn();
    render(<Target onFiles={onFiles} />);
    const file = new File(["invented"], "diagram.png", {
      type: "image/png",
    });
    const dataTransfer = {
      dropEffect: "none",
      files: [file],
      types: ["Files"],
    };

    fireEvent.dragEnter(screen.getByRole("textbox"), { dataTransfer });
    expect(screen.getByRole("status").textContent).toBe(
      "Drop files to attach",
    );

    fireEvent.drop(screen.getByRole("textbox"), { dataTransfer });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
