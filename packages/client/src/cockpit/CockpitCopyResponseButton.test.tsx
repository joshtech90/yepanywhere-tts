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

import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitCopyResponseButton } from "./CockpitCopyResponseButton";

beforeEach(() => {
  clipboardMocks.writeClipboardText.mockReset();
  localStorage.setItem(UI_KEYS.locale, "en");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Cockpit response copy button", () => {
  it("copies the unchanged response text and confirms success", async () => {
    clipboardMocks.writeClipboardText.mockResolvedValue(true);
    const response = "## Result\n\nInvented answer.";

    render(
      <I18nProvider>
        <CockpitCopyResponseButton text={response} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy response" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Response copied" }),
      ).toBeTruthy();
    });
    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith(response);
  });

  it("keeps a failed copy actionable at the same control", async () => {
    clipboardMocks.writeClipboardText.mockResolvedValue(false);

    render(
      <I18nProvider>
        <CockpitCopyResponseButton text="Invented answer." />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy response" }));

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
