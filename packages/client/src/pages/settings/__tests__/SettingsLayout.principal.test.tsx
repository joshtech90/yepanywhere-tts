// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ActingPrincipal } from "@yep-anywhere/shared";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsLayout } from "../SettingsLayout";

/** Contract: topics/limited-users.md § Delivery v1 — Settings → Users. */

const SUPERUSER: ActingPrincipal = {
  superuser: true,
  username: null,
  switched: false,
  locked: false,
  enabled: true,
  hasLimitedUsers: true,
  logoutRedirect: "stay",
};

const LIMITED: ActingPrincipal = {
  ...SUPERUSER,
  superuser: false,
  username: "alice",
  locked: true,
};

const { principalState } = vi.hoisted(() => ({
  principalState: {
    principal: null as unknown as ActingPrincipal,
    resolved: true,
  },
}));

vi.mock("../../../hooks/useActingPrincipal", () => ({
  useActingPrincipal: () => ({
    principal: principalState.principal,
    loading: false,
    resolved: principalState.resolved,
    refresh: vi.fn(),
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

vi.mock("../LocalAccessSettings", () => ({
  LocalAccessSettings: () => <p>local access pane</p>,
}));

vi.mock("../SettingsBackupActions", () => ({
  SettingsBackupActions: () => <p>backup actions</p>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:category" element={<SettingsLayout />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("SettingsLayout principal gating", () => {
  it("renders no category before the acting principal is known", async () => {
    // Load the lazy pane once, so its absence below is the gate and not a
    // module still loading.
    principalState.principal = SUPERUSER;
    principalState.resolved = true;
    renderAt("/settings/local-access");
    expect(await screen.findByText("local access pane")).toBeTruthy();
    cleanup();

    // A limited user's placeholder principal is the superuser until the
    // server answers; the superuser-only pane must not mount in that window.
    principalState.resolved = false;
    renderAt("/settings/local-access");
    await act(async () => {});
    expect(screen.queryByText("local access pane")).toBeNull();
    expect(screen.queryByText("backup actions")).toBeNull();
    expect(screen.queryByRole("button", { name: /local-access/i })).toBeNull();
  });

  it("withholds a superuser-only category from a resolved limited user", async () => {
    principalState.principal = SUPERUSER;
    principalState.resolved = true;
    renderAt("/settings/local-access");
    expect(await screen.findByText("local access pane")).toBeTruthy();
    cleanup();

    principalState.principal = LIMITED;
    renderAt("/settings/local-access");
    await act(async () => {});
    expect(screen.queryByText("local access pane")).toBeNull();
    expect(screen.queryByText("backup actions")).toBeNull();
  });
});
