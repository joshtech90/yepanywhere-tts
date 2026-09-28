// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { readDraftTextValue } from "../../lib/draftEnvelope";
import { MessageInput } from "../MessageInput";

// Unlike MessageInput.test.tsx, this file keeps the real draft persistence:
// what a bang run does to the stored draft is the behavior under test.

// Hook results are stable objects, as the real hooks' are between changes;
// fresh objects per render feed effects that republish them without end.
const hookResults = vi.hoisted(() => ({
  modelSettings: {
    thinkingMode: "off",
    cycleThinkingMode: () => {},
    thinkingLevel: "high",
    setThinkingMode: () => {},
    setEffortLevel: () => {},
    voiceInputEnabled: false,
    speechMethod: "browser-native",
    hasStoredSpeechMethod: false,
    setSpeechMethod: () => {},
    speechSmartTurnSettings: { enabled: false, threshold: 0.95, timeoutMs: 0 },
    setSpeechSmartTurnSettings: () => {},
    grokSpeechAudioSettings: { uplinkMode: "pcm16" },
    setGrokSpeechAudioSettings: () => {},
  },
  version: {
    version: { current: "test", capabilities: [], voiceBackends: [] },
    loading: false,
    error: null,
    refetch: () => {},
    refetchFresh: () => {},
  },
  providers: { providers: [] },
  serverSettings: {
    settings: { clientDefaults: {} },
    isLoading: false,
    error: null,
    updateSettings: () => {},
    updateSetting: async () => undefined,
    refetch: () => {},
  },
}));

vi.mock("../../hooks/useModelSettings", () => ({
  useModelSettings: () => hookResults.modelSettings,
}));

vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => hookResults.version,
}));

vi.mock("../../hooks/useProviders", () => ({
  useProviders: () => hookResults.providers,
}));

vi.mock("../../hooks/useServerSettings", () => ({
  useServerSettings: () => hookResults.serverSettings,
}));

const DRAFT_KEY = "bang-draft-test";

function storedDraftText(): string {
  return readDraftTextValue(window.localStorage.getItem(DRAFT_KEY));
}

function deferredRun() {
  let settle: { resolve: () => void; reject: (error: Error) => void } = {
    resolve: () => {},
    reject: () => {},
  };
  const onRun = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  return {
    onRun,
    resolve: () => settle.resolve(),
    reject: () => settle.reject(new Error("route unavailable")),
  };
}

function renderComposer(onRun: (command: string) => Promise<void>) {
  render(
    <I18nProvider>
      <MessageInput
        onSend={vi.fn()}
        draftKey={DRAFT_KEY}
        placeholder="Message"
        supportsPermissionMode={false}
        supportsThinkingToggle={false}
        bangSupport={{
          onRun,
          fetchCompletions: vi.fn(async () => ({
            completions: [],
            history: [],
          })),
          history: [],
        }}
      />
    </I18nProvider>,
  );
  return screen.getByPlaceholderText("Message") as HTMLTextAreaElement;
}

function submitBang(textarea: HTMLTextAreaElement, text: string) {
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter" });
}

describe("MessageInput bang command draft", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps what is typed while a bang command is still starting", async () => {
    const run = deferredRun();
    const textarea = renderComposer(run.onRun);
    submitBang(textarea, "!!make test");

    expect(run.onRun).toHaveBeenCalledWith("make test");
    expect(textarea.value).toBe("");
    fireEvent.change(textarea, { target: { value: "next message" } });
    await act(async () => {
      run.resolve();
    });

    expect(textarea.value).toBe("next message");
    expect(storedDraftText()).toBe("next message");
  });

  it("forgets a bang command's draft once its run is accepted", async () => {
    const run = deferredRun();
    const textarea = renderComposer(run.onRun);
    submitBang(textarea, "!!make test");
    await act(async () => {
      run.resolve();
    });

    expect(textarea.value).toBe("");
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("brings a failed bang command back for retry", async () => {
    const run = deferredRun();
    const textarea = renderComposer(run.onRun);
    submitBang(textarea, "!!make test");
    await act(async () => {
      run.reject();
    });

    expect(textarea.value).toBe("!!make test");
    expect(storedDraftText()).toBe("!!make test");
  });

  it("keeps a newer draft when a bang command started under it fails", async () => {
    const run = deferredRun();
    const textarea = renderComposer(run.onRun);
    submitBang(textarea, "!!make test");
    fireEvent.change(textarea, { target: { value: "next message" } });
    await act(async () => {
      run.reject();
    });

    expect(textarea.value).toBe("next message");
    expect(storedDraftText()).toBe("next message");
  });
});
