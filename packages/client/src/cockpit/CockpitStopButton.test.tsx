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
  it("stays a direct action and suppresses repeated stop requests", async () => {
    let release = () => {};
    const stop = vi.fn(
      () =>
        new Promise<{ kind: "accepted" }>((resolve) => {
          release = () => resolve({ kind: "accepted" });
        }),
    );
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
    expect(
      screen.getByRole("button", { name: "Stop current turn" }),
    ).toBe(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(stop).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      release();
      await Promise.resolve();
    });

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
      (screen.getByRole("button", {
        name: "Stop current turn",
      }) as HTMLButtonElement).disabled,
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
