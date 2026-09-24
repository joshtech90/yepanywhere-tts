import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { createCockpitNavigation } from "./core/navigation";
import { useCockpitShortcuts } from "./useCockpitShortcuts";

function Fixture({
  onHelp,
  onSearch,
  onStop,
}: {
  onHelp: () => void;
  onSearch: () => void;
  onStop: () => void;
}) {
  const location = useLocation();
  const rootRef = useRef<HTMLElement>(null);
  const navigation = useMemo(() => createCockpitNavigation(""), []);
  useCockpitShortcuts({
    navigation,
    onCloseHelp: vi.fn(),
    onCloseSearch: vi.fn(),
    onOpenHelp: onHelp,
    onOpenSearch: onSearch,
    rootRef,
    searchOpen: false,
    shortcutsOpen: false,
  });
  return (
    <main ref={rootRef}>
      <output aria-label="location">{location.pathname}</output>
      <textarea data-cockpit-shortcut="composer" aria-label="Composer" />
      <button
        data-cockpit-shortcut="stop"
        onClick={onStop}
        type="button"
      >
        Stop
      </button>
    </main>
  );
}

afterEach(cleanup);

describe("useCockpitShortcuts", () => {
  it("runs global actions, the navigation chord, composer focus, and stop", () => {
    const onHelp = vi.fn();
    const onSearch = vi.fn();
    const onStop = vi.fn();
    render(
      <MemoryRouter initialEntries={["/cockpit"]}>
        <Fixture onHelp={onHelp} onSearch={onSearch} onStop={onStop} />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "/" });
    fireEvent.keyDown(document, { key: "?" });
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "p" });
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onHelp).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("location").textContent).toBe("/projects");

    fireEvent.keyDown(document, { key: "r" });
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does not take letter or slash input away from the composer", () => {
    const onSearch = vi.fn();
    render(
      <MemoryRouter>
        <Fixture onHelp={vi.fn()} onSearch={onSearch} onStop={vi.fn()} />
      </MemoryRouter>,
    );
    const composer = screen.getByRole("textbox");
    composer.focus();
    fireEvent.keyDown(composer, { key: "n" });
    fireEvent.keyDown(composer, { key: "/" });
    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("location").textContent).toBe("/");
  });

  it("passes the focused keyboard origin to overlays", () => {
    const onHelp = vi.fn();
    const onSearch = vi.fn();
    render(
      <MemoryRouter>
        <Fixture onHelp={onHelp} onSearch={onSearch} onStop={vi.fn()} />
      </MemoryRouter>,
    );
    const stop = screen.getByRole("button", { name: "Stop" });
    stop.focus();

    fireEvent.keyDown(stop, { key: "?" });
    fireEvent.keyDown(stop, { key: "/" });

    expect(onHelp).toHaveBeenCalledWith(stop);
    expect(onSearch).toHaveBeenCalledWith(stop);
  });
});
