// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { formatClientSettingsDocument } from "../../../lib/clientSettingsClipboard";
import { BROWSER_LOCAL_KEYS, UI_KEYS } from "../../../lib/storageKeys";
import { SettingsClipboardTransfer } from "../SettingsClipboardTransfer";

const reload = vi.fn();

function renderTransfer() {
  return render(
    <I18nProvider>
      <SettingsClipboardTransfer />
    </I18nProvider>,
  );
}

function setClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
}

describe("SettingsClipboardTransfer", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, host: "linux:3400", reload },
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setClipboard(undefined);
    vi.clearAllMocks();
  });

  it("copies only portable preferences", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    localStorage.setItem(UI_KEYS.theme, "verydark");
    localStorage.setItem(BROWSER_LOCAL_KEYS.xaiSttApiKey, "secret");

    renderTransfer();
    fireEvent.click(screen.getByRole("button", { name: "Copy settings" }));

    // I18nProvider stores the locale, which is portable too.
    expect(
      await screen.findByText("Copied to the clipboard, settings: 2"),
    ).toBeTruthy();
    const copied = JSON.parse(writeText.mock.calls[0]?.[0] as string);
    expect(copied).toMatchObject({
      kind: "ya-client-settings",
      version: 1,
      sourceHost: "linux:3400",
    });
    expect(copied.settings).toEqual({
      [UI_KEYS.locale]: localStorage.getItem(UI_KEYS.locale),
      [UI_KEYS.theme]: "verydark",
    });
    expect(JSON.stringify(copied)).not.toContain("secret");
  });

  it("shows the text for manual copy when the clipboard is unavailable", async () => {
    localStorage.setItem(UI_KEYS.theme, "verydark");

    renderTransfer();
    fireEvent.click(screen.getByRole("button", { name: "Copy settings" }));

    const field = (await screen.findByLabelText(
      "Copied settings text",
    )) as HTMLTextAreaElement;
    expect(JSON.parse(field.value).settings).toMatchObject({
      [UI_KEYS.theme]: "verydark",
    });
  });

  it("previews pasted changes and applies them with a reload", async () => {
    localStorage.setItem(UI_KEYS.theme, "light");
    localStorage.setItem(UI_KEYS.fontSize, "large");
    localStorage.setItem(BROWSER_LOCAL_KEYS.xaiSttApiKey, "secret");
    renderTransfer();
    const text = formatClientSettingsDocument(
      {
        [UI_KEYS.locale]: localStorage.getItem(UI_KEYS.locale) ?? "",
        [UI_KEYS.theme]: "verydark",
      },
      "windows:3400",
    );
    setClipboard({ readText: vi.fn().mockResolvedValue(text) });

    fireEvent.click(screen.getByRole("button", { name: "Paste settings" }));

    expect(
      await screen.findByText(
        "Settings that would change: 2 (copied from windows:3400)",
      ),
    ).toBeTruthy();
    expect(screen.getByText("light → verydark")).toBeTruthy();
    expect(screen.getByText("large → default")).toBeTruthy();
    expect(localStorage.getItem(UI_KEYS.theme)).toBe("light");

    fireEvent.click(
      screen.getByRole("button", { name: "Apply to this browser" }),
    );

    expect(localStorage.getItem(UI_KEYS.theme)).toBe("verydark");
    expect(localStorage.getItem(UI_KEYS.fontSize)).toBeNull();
    expect(localStorage.getItem(BROWSER_LOCAL_KEYS.xaiSttApiKey)).toBe(
      "secret",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("accepts typed text when clipboard read is denied", async () => {
    setClipboard({
      readText: vi.fn().mockRejectedValue(new Error("denied")),
    });

    renderTransfer();
    fireEvent.click(screen.getByRole("button", { name: "Paste settings" }));
    const field = await screen.findByLabelText("Pasted settings text");

    fireEvent.change(field, { target: { value: "not settings" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(
      await screen.findByText("The pasted text is not copied YA settings"),
    ).toBeTruthy();

    fireEvent.change(field, {
      target: {
        value: formatClientSettingsDocument(
          { [UI_KEYS.theme]: "verydark" },
          "windows:3400",
        ),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    await waitFor(() => {
      expect(screen.getByText("default → verydark")).toBeTruthy();
    });
    expect(reload).not.toHaveBeenCalled();
  });
});
