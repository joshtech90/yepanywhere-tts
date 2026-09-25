import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clipboardMocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(),
}));

vi.mock("../lib/clipboard", () => ({
  writeClipboardText: clipboardMocks.writeClipboardText,
}));

import { CockpitToolCopyButton } from "./CockpitToolCopyButton";

beforeEach(() => {
  clipboardMocks.writeClipboardText.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Cockpit tool copy button", () => {
  it("copies the unchanged tool text and confirms success", async () => {
    clipboardMocks.writeClipboardText.mockResolvedValue(true);
    const command = "printf 'invented example\\n'";

    render(
      <CockpitToolCopyButton
        copiedLabel="Command copied"
        failedLabel="Copy unavailable — try again"
        label="Copy command"
        text={command}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Command copied" }),
      ).toBeTruthy();
    });
    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith(command);
  });

  it("keeps a failed tool copy actionable", async () => {
    clipboardMocks.writeClipboardText.mockResolvedValue(false);

    render(
      <CockpitToolCopyButton
        copiedLabel="Output copied"
        failedLabel="Copy unavailable — try again"
        label="Copy output"
        text="Invented output"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy output" }));

    const retry = await screen.findByRole("button", {
      name: "Copy unavailable — try again",
    });
    expect(retry.getAttribute("data-state")).toBe("error");

    fireEvent.click(retry);
    await waitFor(() => {
      expect(clipboardMocks.writeClipboardText).toHaveBeenCalledTimes(2);
    });
  });
});
