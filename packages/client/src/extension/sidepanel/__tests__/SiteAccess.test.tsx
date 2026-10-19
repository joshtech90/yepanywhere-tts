import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { SiteAccess } from "../SiteAccess";

function permissions() {
  const listeners = new Set<() => void>();
  const event = {
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
  };
  const api = {
    contains: vi.fn().mockResolvedValue(false),
    request: vi.fn().mockResolvedValue(false),
    onAdded: event,
    onRemoved: event,
  };
  vi.stubGlobal("chrome", { runtime: { id: "extension" }, permissions: api });
  return {
    api,
    changed: () => {
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("site access invitation", () => {
  it("does not let a stale check hide the CTA after access is revoked", async () => {
    const { api, changed } = permissions();
    let initialCheck!: (granted: boolean) => void;
    api.contains.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (initialCheck = resolve)),
    );
    render(
      <I18nProvider>
        <SiteAccess
          tab={{ tabId: 12, url: "https://github.com/", clicked: false }}
        />
      </I18nProvider>,
    );
    await act(async () => changed());
    fireEvent.click(
      await screen.findByRole("button", { name: "Allow scanning this page" }),
    );
    const allow = await screen.findByRole("button", {
      name: "Allow github.com…",
    });
    await act(async () => initialCheck(true));
    expect(screen.getByRole("button", { name: "Allow github.com…" })).toBe(
      allow,
    );
    api.contains.mockResolvedValue(true);
    await act(async () => changed());
    expect(screen.queryByRole("button")).toBeNull();
    api.contains.mockResolvedValue(false);
    await act(async () => changed());
    expect(
      await screen.findByRole("button", { name: "Allow github.com…" }),
    ).toBeTruthy();
  });

  it("switches toolbar instructions to a retryable site request once the URL is known", async () => {
    const { api } = permissions();
    const panel = (url?: string) => (
      <I18nProvider>
        <SiteAccess tab={{ tabId: 12, url, clicked: false }} />
      </I18nProvider>
    );
    const view = render(panel());
    const disclosure = screen.getByRole("button", {
      name: "Allow scanning this page",
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading")).toBeNull();
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading")).toBeTruthy();
    expect(api.request).not.toHaveBeenCalled();
    fireEvent.click(disclosure);
    expect(screen.queryByRole("heading")).toBeNull();
    fireEvent.click(disclosure);

    // The toolbar publishes the URL; the same panel can now ask for its origin.
    view.rerender(panel("https://tomfit.atlassian.net/"));
    expect(
      (
        await screen.findByRole("button", { name: "Allow scanning this page" })
      ).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.queryByText("Click the Yep Anywhere icon")).toBeNull();
    api.request.mockRejectedValueOnce(new Error("request failed"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Allow tomfit.atlassian.net…",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "could not request access",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Allow tomfit.atlassian.net…" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "was not granted",
    );
    api.request.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Allow tomfit.atlassian.net…" }),
      );
    });
    expect(screen.queryByRole("button")).toBeNull();
    view.rerender(panel("https://example.com/"));
    expect(
      (
        await screen.findByRole("button", { name: "Allow scanning this page" })
      ).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen.queryByRole("button", { name: "Allow example.com…" }),
    ).toBeNull();
  });
});
