import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(async () => true),
  handoff: {
    phase: "idle" as "idle" | "summarizing" | "starting" | "error",
    error: null,
    start: vi.fn(async () => {}),
    reset: vi.fn(),
  },
}));

vi.mock("../lib/clipboard", () => ({
  writeClipboardText: mocks.writeClipboardText,
}));
vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({ sourceKey: "local", transport: {} }),
}));
vi.mock("../hooks/useModelSettings", () => ({
  useModelSettings: () => ({}),
}));
vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({ providers: [] }),
}));
vi.mock("../hooks/useServerSettings", () => ({
  useServerSettings: () => ({ settings: null }),
}));
vi.mock("./useCockpitHandoff", () => ({
  useCockpitHandoff: () => mocks.handoff,
}));

import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitQuickActions } from "./CockpitQuickActions";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";

const PROJECT_ID = btoa("/tmp/yep-cockpit-test")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");

function actionsTree(
  busy: boolean,
  processState: CockpitComposerSessionPort["processState"] = "idle",
  autoReadAloud?: { enabled: boolean; toggle: () => void },
) {
  const port = {
    actualSessionId: "24e22f93-9d63-44d6-b237-6d765a2b8346",
    permissionMode: "default",
    processState,
    session: { provider: "claude" },
    status: { owner: "none" },
  } as unknown as CockpitComposerSessionPort;
  return (
    <MemoryRouter>
      <I18nProvider>
        <CockpitQuickActions
          autoReadAloud={autoReadAloud}
          basePath=""
          busy={busy}
          entries={[]}
          port={port}
          projectId={PROJECT_ID}
          sessionId="24e22f93-9d63-44d6-b237-6d765a2b8346"
          sessionTitle="Test"
        />
      </I18nProvider>
    </MemoryRouter>
  );
}

function renderActions(busy: boolean) {
  return render(actionsTree(busy));
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
  mocks.writeClipboardText.mockClear();
  mocks.handoff.phase = "idle";
  mocks.handoff.reset.mockClear();
});

describe("Cockpit quick actions", () => {
  it("copies the terminal command for the session", async () => {
    renderActions(false);
    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));

    fireEvent.click(
      screen.getByRole("menuitem", { name: /Continue in a terminal/ }),
    );

    await vi.waitFor(() =>
      expect(mocks.writeClipboardText).toHaveBeenCalledWith(
        "cd '/tmp/yep-cockpit-test' && claude --resume 24e22f93-9d63-44d6-b237-6d765a2b8346",
      ),
    );
  });

  it("offers the handoff only while the session is not working", () => {
    renderActions(true);
    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));

    const handoff = screen.getByRole("menuitem", {
      name: /New session with handoff/,
    }) as HTMLButtonElement;
    expect(handoff.disabled).toBe(true);
    expect(handoff.textContent).toContain("no longer working");
  });

  it("keeps Cancel reachable when the session asks for an approval mid-handoff", () => {
    const { rerender } = renderActions(false);
    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /New session with handoff/ }),
    );
    const cancel = () =>
      // jsdom leaves the modal <dialog> closed, so its content counts as hidden.
      screen.getByRole("button", {
        hidden: true,
        name: "Cancel",
      }) as HTMLButtonElement;

    mocks.handoff.phase = "summarizing";
    rerender(actionsTree(false, "in-turn"));
    expect(cancel().disabled).toBe(true);

    rerender(actionsTree(false, "waiting-input"));
    expect(screen.getByText(/waiting for an approval/)).toBeDefined();
    expect(cancel().disabled).toBe(false);

    mocks.handoff.reset.mockClear(); // opening the dialog resets it, too
    fireEvent.click(cancel());
    expect(mocks.handoff.reset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/waiting for an approval/)).toBeNull();
  });

  it("switches auto read-aloud for the session from the menu", () => {
    const toggle = vi.fn();
    const { rerender } = render(
      actionsTree(false, "idle", { enabled: false, toggle }),
    );
    const trigger = screen.getByRole("button", { name: "Quick actions" });
    expect(trigger.getAttribute("data-auto-read")).toBeNull();
    fireEvent.click(trigger);

    const item = screen.getByRole("menuitemcheckbox", {
      name: /Read answers aloud automatically/,
    });
    expect(item.getAttribute("aria-checked")).toBe("false");
    expect(item.textContent).toContain("For this session only");
    fireEvent.click(item);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    rerender(actionsTree(false, "idle", { enabled: true, toggle }));
    expect(trigger.getAttribute("data-auto-read")).toBe("on");
    fireEvent.click(trigger);
    expect(
      screen
        .getByRole("menuitemcheckbox", {
          name: /Read answers aloud automatically/,
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("hides the auto read-aloud entry without a switch", () => {
    renderActions(false);
    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  });
});
