import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import {
  CockpitShortcutButton,
  CockpitShortcutDialog,
} from "./CockpitShortcutHelp";

function Fixture() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <I18nProvider>
      <CockpitShortcutButton
        onOpen={() => setOpen(true)}
        open={open}
        triggerRef={triggerRef}
      />
      <CockpitShortcutDialog
        focusReturnRef={triggerRef}
        onClose={() => setOpen(false)}
        open={open}
        triggerRef={triggerRef}
      />
    </I18nProvider>
  );
}

afterEach(cleanup);
beforeEach(() => localStorage.setItem(UI_KEYS.locale, "en"));

describe("Cockpit shortcut help", () => {
  it("documents the complete shortcut set in a focus-contained modal", () => {
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: "Keyboard shortcuts" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Search all sessions")).toBeTruthy();
    expect(screen.getByText("Queue the current draft")).toBeTruthy();
    expect(screen.getByText("Stop the running response")).toBeTruthy();

    const close = screen
      .getAllByRole("button", { name: "Close shortcuts" })
      .find((button) => dialog.contains(button));
    if (!close) throw new Error("shortcut close button missing");
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes from the backdrop without treating panel clicks as dismissal", () => {
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: "Keyboard shortcuts" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const backdropDismiss = screen
      .getAllByRole("button", { name: "Close shortcuts" })
      .find((button) => !dialog.contains(button));
    if (!backdropDismiss) throw new Error("shortcut backdrop action missing");

    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(backdropDismiss);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
