// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ActingPrincipal, LimitedUserSummary } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsersSettings } from "../UsersSettings";

/** Contract: topics/limited-users.md § Delivery v1 — Settings → Users. */

const {
  principalState,
  settingsState,
  mockListUsers,
  mockCreateUser,
  mockDeleteUser,
  mockUpdateSetting,
  mockRefreshPrincipal,
} = vi.hoisted(() => ({
  principalState: {
    principal: {
      superuser: true,
      username: null,
      switched: false,
      locked: false,
      enabled: false,
      hasLimitedUsers: false,
      logoutRedirect: "stay",
    } as ActingPrincipal,
    resolved: true,
  },
  settingsState: { settings: {} as Record<string, unknown> },
  mockListUsers: vi.fn(),
  mockCreateUser: vi.fn(),
  mockDeleteUser: vi.fn(),
  mockUpdateSetting: vi.fn(),
  mockRefreshPrincipal: vi.fn(),
}));

vi.mock("../../../api/client", () => ({
  api: {
    listUsers: mockListUsers,
    createUser: mockCreateUser,
    updateUser: vi.fn(),
    deleteUser: mockDeleteUser,
    switchUser: vi.fn(),
    logoutUser: vi.fn(),
  },
}));

vi.mock("../../../hooks/useActingPrincipal", () => ({
  useActingPrincipal: () => ({
    principal: principalState.principal,
    loading: false,
    resolved: principalState.resolved,
    refresh: mockRefreshPrincipal,
  }),
}));

vi.mock("../../../hooks/useProjects", () => ({
  useProjects: () => ({
    projects: [{ id: "p1", name: "Alpha", path: "/tmp/alpha" }],
  }),
}));

vi.mock("../../../hooks/useProviders", () => ({
  useProviders: () => ({
    providers: [
      {
        name: "claude",
        displayName: "Claude",
        models: [{ id: "opus", name: "Opus" }],
      },
    ],
  }),
}));

vi.mock("../../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: settingsState.settings,
    isLoading: false,
    error: null,
    updateSetting: mockUpdateSetting,
    updateSettings: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("../SettingsPaneTitleContext", () => ({
  useSettingsPaneTitle: () => {},
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (!vars) return key;
      let text = key;
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
      return text;
    },
  }),
}));

function user(overrides: Partial<LimitedUserSummary> = {}): LimitedUserSummary {
  return {
    username: "alice",
    disabled: false,
    createdAt: "2026-09-20T00:00:00.000Z",
    newSessionProjects: ["p1"],
    joinProjects: [],
    viewProjects: [],
    joinStaleOffsetMinutes: 0,
    lock: {},
    ...overrides,
  };
}

describe("Settings → Users", () => {
  beforeEach(() => {
    principalState.principal = {
      superuser: true,
      username: null,
      switched: false,
      locked: false,
      enabled: false,
      hasLimitedUsers: false,
      logoutRedirect: "stay",
    };
    principalState.resolved = true;
    settingsState.settings = {};
    mockListUsers.mockReset();
    mockCreateUser.mockReset();
    mockDeleteUser.mockReset();
    mockUpdateSetting.mockReset();
    mockRefreshPrincipal.mockReset();
    mockListUsers.mockResolvedValue({ users: [], enabled: false });
    mockCreateUser.mockResolvedValue({ user: user() });
    mockDeleteUser.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("requires confirmation before deleting a user and keeps them on cancel", async () => {
    mockListUsers.mockResolvedValue({ users: [user()], enabled: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<UsersSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "usersDelete" }));
    expect(confirm).toHaveBeenCalledWith("usersDeleteConfirm");
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(screen.getByText("alice")).toBeTruthy();

    confirm.mockReturnValue(true);
    mockListUsers.mockResolvedValue({ users: [], enabled: true });
    fireEvent.click(screen.getByRole("button", { name: "usersDelete" }));
    await waitFor(() => expect(mockDeleteUser).toHaveBeenCalledTimes(1));
    expect(mockDeleteUser).toHaveBeenCalledWith("alice");
    await waitFor(() => expect(screen.queryByText("alice")).toBeNull());
  });

  it("offers the toggle and adding the first user while the feature is off", async () => {
    render(<UsersSettings />);

    await waitFor(() => {
      expect(screen.getByText("usersEmpty")).toBeTruthy();
    });
    // The toggle is present and off, and adding a user does not wait for it.
    const toggle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "usersAddUser" }));
    expect(
      screen.getByPlaceholderText("usersUsernamePlaceholder"),
    ).toBeTruthy();
  });

  it("creates a user and re-reads the acting principal, which the server just enabled", async () => {
    render(<UsersSettings />);
    await waitFor(() => expect(mockListUsers).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "usersAddUser" }));
    fireEvent.change(screen.getByPlaceholderText("usersUsernamePlaceholder"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByPlaceholderText("usersPasswordPlaceholder"), {
      target: { value: "alice-password" },
    });
    fireEvent.change(screen.getByLabelText("Alpha"), {
      target: { value: "new-session" },
    });
    mockListUsers.mockResolvedValue({ users: [user()], enabled: true });
    fireEvent.click(screen.getByRole("button", { name: "usersCreateUser" }));

    await waitFor(() => {
      expect(mockCreateUser).toHaveBeenCalledWith({
        username: "alice",
        password: "alice-password",
        newSessionProjects: ["p1"],
        joinProjects: [],
        viewProjects: [],
        joinStaleOffsetMinutes: 0,
        lock: {},
        // Always sent, so clearing the field revokes the creation grant.
        projectRoot: "",
      });
    });
    // Creating the first user turns the feature on server-side.
    expect(mockRefreshPrincipal).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("alice")).toBeTruthy());
  });

  it("shows a limited user their own account instead of the directory", async () => {
    principalState.principal = {
      superuser: false,
      username: "alice",
      switched: false,
      locked: true,
      enabled: true,
      hasLimitedUsers: true,
      logoutRedirect: "direct-login",
      grants: {
        newSessionProjects: ["p1"],
        joinProjects: [],
        viewProjects: [],
        joinStaleOffsetMinutes: 0,
        lock: { provider: "claude" },
      },
    };
    render(<UsersSettings />);

    expect(screen.getByText("usersSignedInAs")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "usersAddUser" })).toBeNull();
    // They never ask for the directory: that call is refused for them anyway.
    expect(mockListUsers).not.toHaveBeenCalled();
  });

  it("reports an older server without the users surface rather than an error", async () => {
    const missing = Object.assign(new Error("Not found"), { status: 404 });
    mockListUsers.mockRejectedValue(missing);
    render(<UsersSettings />);

    await waitFor(() => {
      expect(screen.getByText("usersUnsupportedServer")).toBeTruthy();
    });
  });

  it("does not call the directory before the server says who this client is", () => {
    principalState.resolved = false;
    render(<UsersSettings />);

    // The placeholder principal looks like the superuser, so asking now would
    // be one refused request per load for a switched or limited principal.
    expect(mockListUsers).not.toHaveBeenCalled();
    expect(screen.getByText("loading")).toBeTruthy();
  });

  it("keeps the directory for a refusal, which is not a missing surface", async () => {
    const refused = Object.assign(new Error("Not permitted"), { status: 403 });
    mockListUsers.mockRejectedValue(refused);
    render(<UsersSettings />);

    await waitFor(() => expect(mockListUsers).toHaveBeenCalled());
    expect(screen.queryByText("usersUnsupportedServer")).toBeNull();
  });
});
