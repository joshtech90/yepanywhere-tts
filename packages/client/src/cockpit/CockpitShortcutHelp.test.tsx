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
  it("documents the complete shortcut set and restores trigger focus", () => {
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: "Keyboard shortcuts" });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Search all sessions")).toBeTruthy();
    expect(screen.getByText("Queue the current draft")).toBeTruthy();
    expect(screen.getByText("Stop the running response")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close shortcuts" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
