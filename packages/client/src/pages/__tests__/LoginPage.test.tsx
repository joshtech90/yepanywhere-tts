// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "../LoginPage";

/**
 * The owner's login page is the pre-limited-users one until the feature is on.
 * Contract: topics/limited-users.md § Login, switching, and logout.
 */

const { authState, mockLogin } = vi.hoisted(() => ({
  authState: { limitedUsersEnabled: false },
  mockLogin: vi.fn(),
}));

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({
    isSetupMode: false,
    login: mockLogin,
    setupAccount: vi.fn(),
    isLoading: false,
    authEnabled: true,
    authDisabledByEnv: false,
    limitedUsersEnabled: authState.limitedUsersEnabled,
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function renderLoginPage() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

/** Submit, and let the login's own state updates settle. */
async function submit() {
  const button = screen.getByRole("button", { name: "loginSubmit" });
  fireEvent.click(button);
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    authState.limitedUsersEnabled = false;
    mockLogin.mockReset();
    mockLogin.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("asks only for the password while limited users are off", async () => {
    renderLoginPage();

    expect(screen.queryByLabelText("loginUsernameOptional")).toBeNull();
    fireEvent.change(screen.getByLabelText("loginPasswordLabel"), {
      target: { value: "owner-password" },
    });
    await submit();
    expect(mockLogin).toHaveBeenCalledWith("owner-password", undefined);
  });

  it("offers a username for a limited user's login once the feature is on", async () => {
    authState.limitedUsersEnabled = true;
    renderLoginPage();

    fireEvent.change(screen.getByLabelText("loginUsernameOptional"), {
      target: { value: " alice " },
    });
    fireEvent.change(screen.getByLabelText("loginPasswordLabel"), {
      target: { value: "alice-password" },
    });
    await submit();
    expect(mockLogin).toHaveBeenCalledWith("alice-password", "alice");
  });
});
