import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { AppViewerToolbar } from "../AppViewerToolbar";

describe("app toolbar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "fullscreenEnabled");
  });
  it("retains controls and their state while collapsed", () => {
    render(
      <I18nProvider>
        <AppViewerToolbar viewerRef={createRef()}>
          <input aria-label="App value" defaultValue="kept" />
        </AppViewerToolbar>
      </I18nProvider>,
    );
    const input = screen.getByLabelText("App value");
    fireEvent.change(input, { target: { value: "edited" } });
    fireEvent.click(
      screen.getByRole("button", { name: /^Collapse app toolbar/ }),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show app toolbar" }));
    expect(screen.getByRole("textbox")).toBe(input);
    expect((input as HTMLInputElement).value).toBe("edited");
  });
  it("requests hidden navigation UI and reports a refused fullscreen request", async () => {
    const requestFullscreen = vi.fn().mockRejectedValue(new Error("Denied"));
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: true,
    });
    const target = document.createElement("section");
    target.requestFullscreen = requestFullscreen;
    render(
      <I18nProvider>
        <AppViewerToolbar viewerRef={{ current: target }}>App</AppViewerToolbar>
      </I18nProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Enter browser fullscreen" }),
    );
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "could not change fullscreen",
    );
  });
});
