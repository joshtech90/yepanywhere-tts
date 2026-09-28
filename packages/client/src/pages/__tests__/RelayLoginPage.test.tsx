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
import { upsertRelayHost } from "../../lib/hostStorage";
import { RelayLoginPage } from "../RelayLoginPage";

/**
 * The password manager saves and restores the identity ("Log in as") with the
 * password; saved hosts restore the server name, which is not an account.
 */

const { connectViaRelay } = vi.hoisted(() => ({
  connectViaRelay: vi.fn(),
}));

vi.mock("../../contexts/RemoteConnectionContext", () => ({
  useRemoteConnection: () => ({
    connectViaRelay,
    isAutoResuming: false,
    setCurrentHostId: vi.fn(),
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const RELAY = "wss://relay.example/ws";

function renderPage() {
  return render(
    <MemoryRouter>
      <RelayLoginPage />
    </MemoryRouter>,
  );
}

const serverField = () =>
  screen.getByTestId("relay-username-input") as HTMLInputElement;
const identityField = () =>
  screen.getByTestId("relay-limited-username-input") as HTMLInputElement;
const passwordField = () =>
  screen.getByTestId("srp-password-input") as HTMLInputElement;

describe("RelayLoginPage", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    });
    connectViaRelay.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers the identity, not the server name, to the password manager", () => {
    renderPage();
    expect(identityField().getAttribute("autocomplete")).toBe("username");
    expect(identityField().name).toBe("username");
    expect(serverField().getAttribute("autocomplete")).toBe("off");
    expect(passwordField().getAttribute("autocomplete")).toBe(
      "current-password",
    );
  });

  it("restores the server name when the identity is filled in", () => {
    upsertRelayHost({
      relayUrl: RELAY,
      relayUsername: "ygraehl",
      srpUsername: "archer",
    });
    renderPage();

    fireEvent.change(identityField(), { target: { value: "archer" } });
    expect(serverField().value).toBe("ygraehl");
  });

  it("keeps a server name the user typed", () => {
    upsertRelayHost({
      relayUrl: RELAY,
      relayUsername: "ygraehl",
      srpUsername: "archer",
    });
    renderPage();

    fireEvent.change(serverField(), { target: { value: "otherbox" } });
    fireEvent.change(identityField(), { target: { value: "archer" } });
    expect(serverField().value).toBe("otherbox");
  });

  it("signs the owner in under the server name and shows it as the identity", async () => {
    renderPage();
    fireEvent.change(serverField(), { target: { value: "YGraehl" } });
    fireEvent.change(passwordField(), { target: { value: "owner-pw" } });
    fireEvent.click(screen.getByTestId("login-button"));

    await waitFor(() => expect(connectViaRelay).toHaveBeenCalledTimes(1));
    expect(connectViaRelay.mock.calls[0]?.[0]).toMatchObject({
      relayUsername: "ygraehl",
      srpUsername: "ygraehl",
      srpPassword: "owner-pw",
    });
    expect(identityField().value).toBe("ygraehl");
  });

  it("looks the server name up at submit when the fill was not seen as an edit", async () => {
    upsertRelayHost({
      relayUrl: RELAY,
      relayUsername: "ygraehl",
      srpUsername: "archer",
    });
    renderPage();
    // A password manager can set values without an input event reaching React.
    identityField().value = "archer";
    passwordField().value = "archer-pw";
    fireEvent.click(screen.getByTestId("login-button"));

    await waitFor(() => expect(connectViaRelay).toHaveBeenCalledTimes(1));
    expect(connectViaRelay.mock.calls[0]?.[0]).toMatchObject({
      relayUsername: "ygraehl",
      srpUsername: "archer",
      srpPassword: "archer-pw",
    });
  });
});
