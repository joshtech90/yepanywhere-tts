import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(async () => true),
}));

vi.mock("../lib/clipboard", () => ({
  writeClipboardText: mocks.writeClipboardText,
}));
vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({ sourceKey: "local", transport: {} }),
}));

import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitQuickActions } from "./CockpitQuickActions";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";

const PROJECT_ID = btoa("/tmp/yep-cockpit-test")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");

function renderActions(busy: boolean) {
  const port = {
    actualSessionId: "24e22f93-9d63-44d6-b237-6d765a2b8346",
    permissionMode: "default",
    processState: "idle",
    session: { provider: "claude" },
    status: { owner: "none" },
  } as unknown as CockpitComposerSessionPort;
  return render(
    <MemoryRouter>
      <I18nProvider>
        <CockpitQuickActions
          basePath=""
          busy={busy}
          entries={[]}
          port={port}
          projectId={PROJECT_ID}
          sessionId="24e22f93-9d63-44d6-b237-6d765a2b8346"
          sessionTitle="Test"
        />
      </I18nProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
  mocks.writeClipboardText.mockClear();
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
});
