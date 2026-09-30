// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsLayout } from "../SettingsLayout";

const gate = vi.hoisted(() => ({
  enabled: false,
  promise: Promise.resolve(),
  release: () => {},
}));
vi.mock("../../../hooks/useActingPrincipal", () => ({
  useActingPrincipal: () => ({
    principal: { superuser: true, username: null },
    resolved: true,
    loading: false,
  }),
}));
vi.mock("../../../hooks/useVersion", () => ({
  useVersion: () => ({ version: { capabilities: [] }, loading: false }),
}));
vi.mock("../../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));
vi.mock("../../../layouts", () => ({
  MainContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useNavigationLayout: () => ({ openSidebar: vi.fn(), isWideScreen: true }),
}));
vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../i18n-settings", () => ({
  getSettingsCategories: () => [
    {
      id: "appearance",
      label: "Appearance",
      description: "Display preferences",
    },
  ],
}));
vi.mock("../AppearanceSettings", async () => {
  const { useSettingsSearchScope } = await import("../SettingsSearchContext");
  const { SettingsItem } = await import("../SettingsItem");
  return {
    AppearanceSettings: () => {
      useSettingsSearchScope();
      if (gate.enabled) throw gate.promise;
      return (
        <SettingsItem label="Theme color">
          <input type="checkbox" aria-label="Theme choice" />
        </SettingsItem>
      );
    },
  };
});

beforeEach(() => {
  gate.enabled = false;
  gate.promise = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
});
afterEach(async () => {
  gate.enabled = false;
  await act(async () => {
    gate.release();
  });
  cleanup();
});

it("acknowledges query updates while deferred row work keeps the prior control mounted", async () => {
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/settings" element={<SettingsLayout />} />
      </Routes>
    </MemoryRouter>,
  );
  const input = screen.getByRole("searchbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "theme" } });
  const control = (await screen.findByRole("checkbox", {
    name: "Theme choice",
  })) as HTMLInputElement;
  fireEvent.click(control);
  expect(control.checked).toBe(true);
  gate.enabled = true;
  for (const query of ["theme c", "theme co", "theme col"]) {
    fireEvent.change(input, { target: { value: query } });
    expect(input.value).toBe(query);
    // An urgent callback/context change would hide this operable control
    // behind its Suspense fallback before the deferred filter can finish.
    expect(screen.queryByRole("checkbox", { name: "Theme choice" })).toBe(
      control,
    );
    expect(control.checked).toBe(true);
  }
  gate.enabled = false;
  await act(async () => {
    gate.release();
  });
  expect(screen.getByRole("checkbox", { name: "Theme choice" })).toBe(control);
});
