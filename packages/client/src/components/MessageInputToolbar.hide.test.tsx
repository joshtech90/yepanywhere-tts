import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  type SessionToolbarVisibility,
  SESSION_TOOLBAR_CONTROL_KEYS,
} from "../hooks/useSessionToolbarPresence";
import {
  MessageInputToolbarView,
  type MessageInputToolbarViewProps,
} from "./MessageInputToolbar";

const hiddenVisibility = Object.fromEntries(
  SESSION_TOOLBAR_CONTROL_KEYS.map((key) => [key, false]),
) as SessionToolbarVisibility;

const t = ((key: string) => {
  const copy: Record<string, string> = {
    appearanceToolbarHide: "Hide",
    toolbarAttachFiles: "Attach files",
    toolbarHideControlMenuAria: "Toolbar control actions",
  };
  return copy[key] ?? key;
}) as unknown as MessageInputToolbarViewProps["t"];

const shortcutsControl: MessageInputToolbarViewProps["shortcutsControl"] = {
  open: false,
  isearchScope: null,
  setOpen: vi.fn(),
  settingsOpen: false,
  setSettingsOpen: vi.fn(),
  hasDualActions: false,
  enterActionKind: "send",
  canSwapEnterAction: false,
  queueShortcutLabel: "Queue",
};

function renderToolbar(overrides: Partial<MessageInputToolbarViewProps> = {}) {
  return render(
    <MessageInputToolbarView
      t={t}
      visibility={{ ...hiddenVisibility, attachments: true }}
      attachmentControl={{
        canAttach: true,
        attachmentCount: 0,
        onAttachClick: vi.fn(),
      }}
      shortcutsControl={shortcutsControl}
      actionsControl={{}}
      {...overrides}
    />,
    { wrapper: I18nProvider },
  );
}

describe("MessageInputToolbar quick hide", () => {
  it("retains Hide in the attachment share menu on right-click", () => {
    const onHideControl = vi.fn();
    renderToolbar({ onHideControl });

    fireEvent.contextMenu(screen.getByTitle("Attach files"));

    expect(
      screen.getByRole("menu", { name: "Share to session" }).textContent,
    ).toContain("Attach files");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(onHideControl).toHaveBeenCalledWith("attachments");
  });
});
