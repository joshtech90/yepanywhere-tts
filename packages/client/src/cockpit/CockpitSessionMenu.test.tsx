import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import {
  CockpitSessionMenu,
  type CockpitSessionMenuProps,
} from "./CockpitSessionMenu";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(UI_KEYS.locale, "en");
});

function renderMenu(props?: Partial<CockpitSessionMenuProps>) {
  const defaultProps: CockpitSessionMenuProps = {
    open: true,
    anchor: { x: 100, y: 100 },
    sessionTitle: "Sprint Planning",
    pinned: false,
    busy: false,
    onClose: vi.fn(),
    onTogglePin: vi.fn(),
    onRename: vi.fn(() => Promise.resolve(true)),
    onArchive: vi.fn(() => Promise.resolve(true)),
    ...props,
  };

  return {
    ...render(
      <I18nProvider>
        <CockpitSessionMenu {...defaultProps} />
      </I18nProvider>,
    ),
    props: defaultProps,
  };
}

describe("CockpitSessionMenu", () => {
  it("renders three items", () => {
    renderMenu();
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toMatch(/add to favorites/i);
    expect(items[1]?.textContent).toMatch(/rename/i);
    expect(items[2]?.textContent).toMatch(/hide/i);
  });

  it("renders unpin label when pinned", () => {
    renderMenu({ pinned: true });
    const items = screen.getAllByRole("menuitem");
    expect(items[0]?.textContent).toMatch(/remove from favorites/i);
  });

  it("ArrowDown moves focus and wraps", () => {
    renderMenu();
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);

    // Wraps to first item
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);

    // Wraps back with ArrowUp
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
  });

  it("Escape calls onClose and stops propagation", () => {
    const documentKeyDownListener = vi.fn();
    document.addEventListener("keydown", documentKeyDownListener);

    const onClose = vi.fn();
    renderMenu({ onClose });

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(documentKeyDownListener).not.toHaveBeenCalled();

    document.removeEventListener("keydown", documentKeyDownListener);
  });

  it("closes on Tab in menu view", () => {
    const onClose = vi.fn();
    renderMenu({ onClose });

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Tab" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rename submits trimmed title and closes on success", async () => {
    const onRename = vi.fn(() => Promise.resolve(true));
    const onClose = vi.fn();
    renderMenu({ onRename, onClose });

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox");
    expect((input as HTMLInputElement).value).toBe("Sprint Planning");

    fireEvent.change(input, { target: { value: "  Sprint Review  " } });

    const form = input.closest("form");
    expect(form).not.toBeNull();
    if (form) {
      await act(async () => {
        fireEvent.submit(form);
        await Promise.resolve();
      });
    }

    expect(onRename).toHaveBeenCalledWith("Sprint Review");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows error on rename failure and keeps form open", async () => {
    const onRename = vi.fn(() => Promise.resolve(false));
    const onClose = vi.fn();
    renderMenu({ onRename, onClose });

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox");
    const form = input.closest("form");
    if (form) {
      await act(async () => {
        fireEvent.submit(form);
        await Promise.resolve();
      });
    }

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("disables save button when title is whitespace only", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("archive requires confirmation and calls onArchive only after confirm", async () => {
    const onArchive = vi.fn(() => Promise.resolve(true));
    const onClose = vi.fn();
    renderMenu({ onArchive, onClose, sessionTitle: "Sprint Planning" });

    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));

    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.getByText(/Sprint Planning/i)).toBeTruthy();

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    expect(document.activeElement).toBe(cancelButton);

    const confirmButton = screen.getByRole("button", { name: /hide/i });
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
    });

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows error when archive fails", async () => {
    const onArchive = vi.fn(() => Promise.resolve(false));
    const onClose = vi.fn();
    renderMenu({ onArchive, onClose });

    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));

    const confirmButton = screen.getByRole("button", { name: /hide/i });
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
    });

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("outside pointerdown closes", () => {
    const onClose = vi.fn();
    renderMenu({ onClose });

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onTogglePin and onClose on pin action", () => {
    const onTogglePin = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onTogglePin, onClose });

    fireEvent.click(screen.getByRole("menuitem", { name: "Add to favorites" }));

    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to previous active element on close", () => {
    const opener = document.createElement("button");
    opener.type = "button";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const view = render(
      <I18nProvider>
        <CockpitSessionMenu
          open={true}
          anchor={{ x: 100, y: 100 }}
          sessionTitle="Sprint Planning"
          pinned={false}
          busy={false}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
          onRename={vi.fn(() => Promise.resolve(true))}
          onArchive={vi.fn(() => Promise.resolve(true))}
        />
      </I18nProvider>,
    );

    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);

    view.rerender(
      <I18nProvider>
        <CockpitSessionMenu
          open={false}
          anchor={{ x: 100, y: 100 }}
          sessionTitle="Sprint Planning"
          pinned={false}
          busy={false}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
          onRename={vi.fn(() => Promise.resolve(true))}
          onArchive={vi.fn(() => Promise.resolve(true))}
        />
      </I18nProvider>,
    );

    expect(document.activeElement).toBe(opener);
    document.body.removeChild(opener);
  });
});

describe("CockpitSessionMenu without confirmation", () => {
  it("hides an idle session at once", async () => {
    const onArchive = vi.fn(() => Promise.resolve(true));
    const onClose = vi.fn();
    renderMenu({ onArchive, onClose, confirmArchive: false });

    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));

    await vi.waitFor(() => expect(onArchive).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
