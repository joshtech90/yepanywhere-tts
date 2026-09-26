import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitCodexUpdateNotice } from "./CockpitCodexUpdateNotice";

const mocks = vi.hoisted(() => ({
  useCodexUpdateStatus: vi.fn(),
  useServerSettings: vi.fn(),
}));

vi.mock("../hooks/useCodexUpdateStatus", () => ({
  useCodexUpdateStatus: (...args: unknown[]) =>
    mocks.useCodexUpdateStatus(...args),
}));

vi.mock("../hooks/useServerSettings", () => ({
  useServerSettings: () => mocks.useServerSettings(),
}));

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(UI_KEYS.locale, "en");
  mocks.useServerSettings.mockReturnValue({
    settings: { codexUpdatePolicy: "notify" },
  });
  mocks.useCodexUpdateStatus.mockReturnValue({
    status: {
      installed: "0.4.2",
      latest: "0.4.3",
      updateAvailable: true,
    },
  });
});

describe("Cockpit Codex update notice", () => {
  it("offers a quiet route-safe handoff and remembers Not now", () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <CockpitCodexUpdateNotice basePath="/-/relay/studio/" />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("0.4.3");
    expect(
      screen.getByRole("link", { name: "Review update" }).getAttribute("href"),
    ).toBe("/-/relay/studio/settings");

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(localStorage.getItem("codex-update-seen-tag")).toBe("0.4.3");
  });
});
