// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertRelayHost } from "../../lib/hostStorage";
import { matchesRelayLoginTarget } from "../../lib/remoteRoutePaths";
import { RelayLoginPage } from "../RelayLoginPage";

/**
 * Saved login credentials always target the computer name and password.
 * The optional limited-user identity is an independent Advanced field.
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

function renderPage(url = "/login/relay") {
  return render(
    <MemoryRouter initialEntries={[url]}>
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

  it("keeps the computer name as the autocomplete username with Advanced open or closed", () => {
    renderPage();
    expect(screen.queryByTestId("relay-limited-username-input")).toBeNull();
    expect(serverField().getAttribute("autocomplete")).toBe("username");
    expect(serverField().name).toBe("username");
    expect(serverField().id).toBe("relayUsername");
    expect(passwordField().getAttribute("autocomplete")).toBe(
      "current-password",
    );

    fireEvent.click(screen.getByText("relayLoginShowAdvanced"));
    expect(identityField().getAttribute("autocomplete")).toBe("off");
    expect(identityField().name).toBe("limited-user");
    expect(serverField().getAttribute("autocomplete")).toBe("username");
    expect(serverField().name).toBe("username");
    expect(document.querySelectorAll('[autocomplete="username"]')).toHaveLength(
      1,
    );

    fireEvent.click(screen.getByText("relayLoginHideAdvanced"));
    expect(screen.queryByTestId("relay-limited-username-input")).toBeNull();
    expect(serverField().name).toBe("username");
    expect(serverField().getAttribute("autocomplete")).toBe("username");
  });

  it("requires a computer name even when a limited user has a saved host", async () => {
    upsertRelayHost({
      relayUrl: RELAY,
      relayUsername: "ownerbox",
      srpUsername: "guest",
    });
    renderPage();
    fireEvent.click(screen.getByText("relayLoginShowAdvanced"));
    fireEvent.change(identityField(), { target: { value: "guest" } });
    fireEvent.change(passwordField(), { target: { value: "guest-pw" } });
    expect(serverField().value).toBe("");
    fireEvent.click(screen.getByTestId("login-button"));
    expect(screen.getByTestId("login-error").textContent).toBe(
      "relayLoginErrorServerNameRequired",
    );
    expect(connectViaRelay).not.toHaveBeenCalled();
  });

  it("signs the owner in without populating the limited-user field", async () => {
    renderPage();
    fireEvent.change(serverField(), { target: { value: "OwnerBox" } });
    fireEvent.change(passwordField(), { target: { value: "owner-pw" } });
    fireEvent.click(screen.getByTestId("login-button"));

    await waitFor(() => expect(connectViaRelay).toHaveBeenCalledTimes(1));
    expect(connectViaRelay.mock.calls[0]?.[0]).toMatchObject({
      relayUsername: "ownerbox",
      srpUsername: "ownerbox",
      srpPassword: "owner-pw",
    });
    fireEvent.click(screen.getByText("relayLoginShowAdvanced"));
    expect(identityField().value).toBe("");
  });

  it("expands a limited-user link and preserves the override when Advanced is collapsed", async () => {
    renderPage("/login/relay?u=ownerbox&as=guest");
    expect(identityField().value).toBe("guest");
    fireEvent.change(identityField(), { target: { value: "OtherGuest" } });
    expect(serverField().value).toBe("ownerbox");
    fireEvent.click(screen.getByText("relayLoginHideAdvanced"));
    fireEvent.change(passwordField(), { target: { value: "guest-pw" } });
    fireEvent.click(screen.getByTestId("login-button"));
    await waitFor(() => expect(connectViaRelay).toHaveBeenCalledTimes(1));
    expect(connectViaRelay.mock.calls[0]?.[0]).toMatchObject({
      relayUsername: "ownerbox",
      srpUsername: "otherguest",
      srpPassword: "guest-pw",
    });
  });

  it("uses live limited-user values independently from the computer name", async () => {
    renderPage("/login/relay?u=ownerbox&as=guest");
    serverField().value = "otherbox";
    identityField().value = "otherguest";
    passwordField().value = "guest-pw";
    fireEvent.click(screen.getByTestId("login-button"));
    await waitFor(() => expect(connectViaRelay).toHaveBeenCalledTimes(1));
    expect(connectViaRelay.mock.calls[0]?.[0]).toMatchObject({
      relayUsername: "otherbox",
      srpUsername: "otherguest",
      srpPassword: "guest-pw",
    });
  });

  it("retargets a prefilled sign-in link to the corrected server it submits", async () => {
    // Switch Host opens a saved entry's login with its server name in `u`.
    // Correcting a typo there must move the redirect target too, or the
    // login routes never leave this page once connected.
    let location = { pathname: "", search: "" };
    function LocationProbe() {
      location = useLocation();
      return null;
    }
    render(
      <MemoryRouter
        initialEntries={[`/login/relay?u=ygrahel&r=${RELAY}&returnTo=%2Fx`]}
      >
        <RelayLoginPage />
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.change(serverField(), { target: { value: "ygraehl" } });
    fireEvent.change(passwordField(), { target: { value: "owner-pw" } });
    fireEvent.click(screen.getByTestId("login-button"));

    await waitFor(() => expect(connectViaRelay).toHaveBeenCalledTimes(1));
    const params = new URLSearchParams(location.search);
    expect(params.get("u")).toBe("ygraehl");
    expect(params.get("r")).toBe(RELAY);
    expect(params.get("returnTo")).toBe("/x");
    expect(matchesRelayLoginTarget(location, "ygraehl", RELAY)).toBe(true);
  });

  it("submits autofilled computer name and password without React input events", async () => {
    renderPage();
    // Password managers can fill the DOM before React sees an edit.
    serverField().value = "OwnerBox";
    passwordField().value = "owner-pw";
    fireEvent.click(screen.getByTestId("login-button"));

    await waitFor(() => expect(connectViaRelay).toHaveBeenCalledTimes(1));
    expect(connectViaRelay.mock.calls[0]?.[0]).toMatchObject({
      relayUsername: "ownerbox",
      srpUsername: "ownerbox",
      srpPassword: "owner-pw",
    });
    fireEvent.click(screen.getByText("relayLoginShowAdvanced"));
    expect(identityField().value).toBe("");
  });
});
