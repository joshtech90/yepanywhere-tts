import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  ttsPlan: vi.fn(),
  ttsSynthesize: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    ttsPlan: apiMocks.ttsPlan,
    ttsSynthesize: apiMocks.ttsSynthesize,
  },
}));

import { I18nProvider } from "../i18n";
import { stopReadAloud } from "../lib/readAloud";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitReadAloudButton } from "./CockpitReadAloudButton";

class MockAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  pause = vi.fn();
  play = vi.fn(async () => {});
}

beforeEach(() => {
  stopReadAloud();
  apiMocks.ttsPlan.mockReset();
  apiMocks.ttsSynthesize.mockReset();
  localStorage.setItem(UI_KEYS.locale, "en");
  vi.stubGlobal("Audio", MockAudio);
});

afterEach(() => {
  cleanup();
  stopReadAloud();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Cockpit read-aloud button", () => {
  it("shows a failed response and retries it from the same control", async () => {
    const failure = new Error("TTS unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});
    apiMocks.ttsPlan
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ chunks: [] });

    render(
      <I18nProvider>
        <CockpitReadAloudButton
          id="assistant-response-1"
          text="An invented response."
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Read response aloud" }),
    );

    const retry = await screen.findByRole("button", {
      name: "Try reading response aloud again",
    });
    expect(screen.getByText("Audio unavailable — try again")).toBeTruthy();
    expect(retry.getAttribute("data-state")).toBe("error");

    fireEvent.click(retry);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Read response aloud" }),
      ).toBeTruthy();
    });
    expect(apiMocks.ttsPlan).toHaveBeenCalledTimes(2);
  });
});
