import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitComposer } from "./CockpitComposer";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";
import { insertDictation } from "./useCockpitDictation";

const mocks = vi.hoisted(() => ({
  voiceBackends: ["ya-groq"] as string[],
  transcribe: vi.fn(),
}));

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({
    sourceKey: "local",
    transport: { fetch: vi.fn(), upload: vi.fn() },
  }),
}));
vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({ providers: [] }),
}));
vi.mock("../hooks/useVersion", () => ({
  useVersion: () => ({ version: { voiceBackends: mocks.voiceBackends } }),
}));
vi.mock("../lib/speechProviders/YaServerProvider", () => ({
  transcribeSpeechAudio: mocks.transcribe,
}));

class FakeRecorder {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"]) });
    this.onstop?.();
  }
}

const port = {
  actualSessionId: "session-1",
  addPendingMessage: vi.fn(() => ({ tempId: "temp-1" })),
  permissionMode: "default",
  processState: "idle",
  reconnectStream: vi.fn(),
  removePendingMessage: vi.fn(),
  session: {
    id: "session-1",
    projectId: "project-1" as UrlProjectId,
    projectName: "Atlas",
    title: "Demo",
    fullTitle: "Demo",
    createdAt: "2026-09-24T09:00:00.000Z",
    updatedAt: "2026-09-24T09:00:01.000Z",
    messageCount: 2,
    ownership: { owner: "none" },
    provider: "codex",
    model: "gpt-5.6-luna",
  },
  setDeferredMessages: vi.fn(),
  setProcessState: vi.fn(),
  setStatus: vi.fn(),
  status: { owner: "none" },
} as unknown as CockpitComposerSessionPort;

function renderComposer() {
  return render(
    <I18nProvider>
      <CockpitComposer
        projectId="project-1"
        sessionId="session-1"
        sessionPort={port}
      />
    </I18nProvider>,
  );
}

const stopTrack = vi.fn();

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(UI_KEYS.locale, "en");
  mocks.voiceBackends = ["ya-groq"];
  mocks.transcribe.mockReset();
  stopTrack.mockReset();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: stopTrack }],
      })),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Cockpit dictation", () => {
  it("offers no mic when the server has no Groq backend", () => {
    mocks.voiceBackends = ["ya-deepgram"];
    renderComposer();
    expect(screen.queryByRole("button", { name: "Dictate (Groq)" })).toBeNull();
  });

  it("keeps keystrokes typed while Groq transcribes and inserts at the caret", async () => {
    let answer: (value: { text: string }) => void = () => {};
    mocks.transcribe.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderComposer();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "Bitte  pruefen" } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dictate (Groq)" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop dictation" }));
    expect(stopTrack).toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "Transcribing…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    // Typing continues while the upload is in flight, keystroke by keystroke.
    for (const char of " jetzt") {
      fireEvent.change(input, { target: { value: input.value + char } });
    }
    await act(async () => {
      answer({ text: "den Server" });
    });

    await waitFor(() =>
      expect(input.value).toBe("Bitte den Server pruefen jetzt"),
    );
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.any(Blob), "ya-groq");
  });
});

describe("insertDictation", () => {
  it("pads with single spaces and appends when no caret is known", () => {
    expect(insertDictation("Hallo", "Welt", null)).toEqual({
      value: "Hallo Welt",
      caret: 10,
    });
    expect(insertDictation("", "Welt", null)).toEqual({
      value: "Welt",
      caret: 4,
    });
    expect(insertDictation("Ab cd", "neu", { start: 3, end: 5 }).value).toBe(
      "Ab neu",
    );
  });
});
