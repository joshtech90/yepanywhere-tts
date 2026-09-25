import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitOrganizationBar } from "./CockpitOrganizationBar";
import type { CockpitOrganizationController } from "./useCockpitOrganization";

function controller(
  overrides: Partial<CockpitOrganizationController> = {},
): CockpitOrganizationController {
  return {
    activeViewId: null,
    pinError: false,
    pinnedOnly: false,
    pendingPins: new Set(),
    views: [],
    activateView: vi.fn(),
    clearActiveView: vi.fn(),
    removeView: vi.fn(),
    saveView: vi.fn(),
    setPinnedOnly: vi.fn(),
    togglePin: vi.fn(async () => true),
    renameSession: vi.fn(async () => true),
    archiveSession: vi.fn(async () => true),
    ...overrides,
  };
}

afterEach(cleanup);
beforeEach(() => localStorage.setItem(UI_KEYS.locale, "en"));

describe("Cockpit organization bar", () => {
  it("saves the current query as a source-local view", () => {
    const organization = controller();
    render(
      <I18nProvider>
        <CockpitOrganizationBar
          onQueryChange={vi.fn()}
          organization={organization}
          query="fictional release"
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save current view" }),
    );

    expect(organization.saveView).toHaveBeenCalledWith({
      label: "fictional release",
      query: "fictional release",
      pinnedOnly: false,
    });
  });

  it("restores and removes a saved view through named touch controls", () => {
    const onQueryChange = vi.fn();
    const organization = controller({
      activeViewId: "view-1",
      pinnedOnly: true,
      views: [
        {
          id: "view-1",
          label: "Review favorites",
          query: "review",
          pinnedOnly: true,
        },
      ],
      activateView: vi.fn(() => ({
        id: "view-1",
        label: "Review favorites",
        query: "review",
        pinnedOnly: true,
      })),
    });
    render(
      <I18nProvider>
        <CockpitOrganizationBar
          onQueryChange={onQueryChange}
          organization={organization}
          query="review"
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Review favorites" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove saved view Review favorites",
      }),
    );

    expect(organization.activateView).toHaveBeenCalledWith("view-1");
    expect(organization.removeView).toHaveBeenCalledWith("view-1");
    expect(onQueryChange).toHaveBeenCalledWith("review");
  });
});
