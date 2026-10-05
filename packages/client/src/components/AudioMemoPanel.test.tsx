import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AudioMemoTranscriptionPlan } from "../lib/audioMemoTranscript";
import { AudioMemoPanel } from "./AudioMemoPanel";

const state = vi.hoisted(() => ({
  plan: null as AudioMemoTranscriptionPlan | null,
  start: vi.fn(),
  cancel: vi.fn(),
  startPreview: vi.fn(),
  plans: [] as AudioMemoTranscriptionPlan[],
  t: (key: string) => key,
}));
vi.mock("../i18n", () => ({ useI18n: () => ({ t: state.t }) }));
vi.mock("../hooks/useSpeechCaptureSettings", () => ({
  useSpeechCaptureSettings: () => ({
    micDeviceId: null,
    reducePlayback: false,
  }),
}));
vi.mock("../hooks/useAudioMemoTranscriptionPlan", () => ({
  useAudioMemoTranscriptionPlan: () => state.plan,
}));
vi.mock("../lib/audioMemoRecording", () => ({
  AudioMemoRecording: class {
    start = state.start;
    cancel = state.cancel;
  },
}));
vi.mock("../lib/audioMemoTranscript", () => ({
  AudioMemoTranscript: class {
    constructor(plan: AudioMemoTranscriptionPlan) {
      state.plans.push(plan);
    }
    startPreview = state.startPreview;
    dispose = vi.fn();
  },
}));
vi.mock("./SpeechWaveform", () => ({ SpeechWaveform: () => null }));
vi.mock("../lib/speechWaveform", () => ({
  clearSpeechWaveform: vi.fn(),
  publishSpeechWaveformSamples: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.plans.length = 0;
  state.plan = {
    method: "ya-dummy",
    basePath: "",
    streaming: false,
    options: {},
  };
});

function pendingCapture() {
  let ready!: (stream: MediaStream) => void;
  state.start.mockReturnValue(
    new Promise<MediaStream>((resolve) => {
      ready = resolve;
    }),
  );
  const props = { onCancel: vi.fn(), onCommit: vi.fn() };
  return { ...render(<AudioMemoPanel {...props} />), ready, props };
}

it("uses streaming metadata that arrives during microphone acquisition", async () => {
  const view = pendingCapture();
  state.plan = { ...state.plan!, streaming: true };
  view.rerender(<AudioMemoPanel {...view.props} />);
  const stream = {} as MediaStream;
  await act(async () => view.ready(stream));

  expect(state.plans).toEqual([state.plan]);
  expect(state.startPreview).toHaveBeenCalledWith(
    stream,
    expect.any(Function),
    expect.any(Function),
  );
  expect(state.start).toHaveBeenCalledOnce();
  expect(state.cancel).not.toHaveBeenCalled();
  view.unmount();
});

it("does not start transcription after cancelling pending microphone acquisition", async () => {
  const view = pendingCapture();
  view.unmount();
  await act(async () => view.ready({} as MediaStream));

  expect(state.cancel).toHaveBeenCalledOnce();
  expect(state.plans).toEqual([]);
  expect(state.startPreview).not.toHaveBeenCalled();
});
