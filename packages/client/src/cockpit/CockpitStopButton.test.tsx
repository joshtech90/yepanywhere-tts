import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitStopButton } from "./CockpitStopButton";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(UI_KEYS.locale, "en");
});

describe("Cockpit stop button", () => {
  it("ignores a delayed stop result after a new turn becomes interruptible", async () => {
    let finishOld: (result: { kind: "error"; message: string }) => void =
      () => {};
    let finishNew: (result: { kind: "accepted" }) => void = () => {};
    const oldStop = () =>
      new Promise<{ kind: "error"; message: string }>((resolve) => {
        finishOld = resolve;
      });
    const newStop = vi.fn(
      () =>
        new Promise<{ kind: "accepted" }>((resolve) => {
          finishNew = resolve;
        }),
    );
    const tree = (
      interruptible: boolean,
      stop: typeof oldStop | typeof newStop,
    ) => (
      <I18nProvider>
        <CockpitStopButton interruptible={interruptible} stop={stop} />
      </I18nProvider>
    );
    const view = render(tree(true, oldStop));
    fireEvent.click(screen.getByRole("button", { name: "Stop current turn" }));
    view.rerender(tree(false, oldStop));
    view.rerender(tree(true, newStop));
    const button = screen.getByRole("button", {
      name: "Stop current turn",
    }) as HTMLButtonElement;
    fireEvent.click(button);
    await act(async () =>
      finishOld({ kind: "error", message: "Old turn failed" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(newStop).toHaveBeenCalledTimes(1);
    await act(async () => finishNew({ kind: "accepted" }));
    expect(button.disabled).toBe(false);
    expect(screen.getByText("Stop requested")).toBeTruthy();
  });

  it("stays a direct action and suppresses repeated stop requests", async () => {
    let release = () => {};
    let attempt = 0;
    const stop = vi.fn((): Promise<{ kind: "accepted" }> => {
      attempt += 1;
      if (attempt > 1) return Promise.resolve({ kind: "accepted" });
      return new Promise<{ kind: "accepted" }>((resolve) => {
        release = () => resolve({ kind: "accepted" });
      });
    });
    const view = render(
      <I18nProvider>
        <CockpitStopButton interruptible stop={stop} />
      </I18nProvider>,
    );

    const button = screen.getByRole("button", { name: "Stop current turn" });
    for (let update = 0; update < 50; update += 1) {
      view.rerender(
        <I18nProvider>
          <CockpitStopButton interruptible stop={stop} />
        </I18nProvider>,
      );
    }
    expect(screen.getByRole("button", { name: "Stop current turn" })).toBe(
      button,
    );
    fireEvent.click(button);
    fireEvent.click(button);
    expect(stop).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Stop current turn",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.getByText("Stop requested")).toBeTruthy();
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(stop).toHaveBeenCalledTimes(2);
    expect((button as HTMLButtonElement).disabled).toBe(false);

    view.rerender(
      <I18nProvider>
        <CockpitStopButton interruptible={false} stop={stop} />
      </I18nProvider>,
    );
    view.rerender(
      <I18nProvider>
        <CockpitStopButton interruptible stop={stop} />
      </I18nProvider>,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Stop current turn",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("does not show a stop action for an idle or externally owned session", () => {
    render(
      <I18nProvider>
        <CockpitStopButton
          interruptible={false}
          stop={vi.fn(() => Promise.resolve({ kind: "stale" as const }))}
        />
      </I18nProvider>,
    );
    expect(
      screen.queryByRole("button", { name: "Stop current turn" }),
    ).toBeNull();
  });
});
