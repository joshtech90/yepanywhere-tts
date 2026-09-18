import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ViewerWindowActions } from "../ViewerWindowActions";

describe("viewer window actions", () => {
  afterEach(() => vi.restoreAllMocks());
  it("copies on left click, opens on Shift-click, and preserves middle-click navigation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const close = vi.fn();
    render(
      <I18nProvider>
        <ViewerWindowActions
          url="https://plan.example.org/review"
          copyUrl="https://public.example.org/review?ya_access=token"
          onClose={close}
        />
      </I18nProvider>,
    );
    const link = screen.getByRole("button", { name: "Copy viewer link" });
    fireEvent.click(link);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://public.example.org/review?ya_access=token",
      ),
    );
    expect(await screen.findByTitle("Copied!")).toBeTruthy();
    fireEvent.click(link, { shiftKey: true });
    expect(open).toHaveBeenCalledWith(
      "https://plan.example.org/review",
      "_blank",
      "noopener,noreferrer",
    );
    const middle = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    link.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("link", { name: "Move viewer to new tab" }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
