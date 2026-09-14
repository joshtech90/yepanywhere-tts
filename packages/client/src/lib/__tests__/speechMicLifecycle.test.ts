import { afterEach, expect, it, vi } from "vitest";
import { resetSpeechCaptureActivityForTests } from "../speechCaptureActivity";
import { armSpeechFollowUp, cancelSpeechFollowUp } from "../speechFollowUp";
import { DirectXaiStreamingSpeechProvider } from "../speechProviders/DirectXaiStreamingSpeechProvider";
import { releaseSharedSpeechMicStream } from "../speechProviders/sharedMicCapture";
import { setBrowserXaiSttApiKey } from "../speechProviders/xaiCredentials";

class Socket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: Socket[] = [];
  readyState = Socket.OPEN;
  bufferedAmount = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  constructor() {
    Socket.instances.push(this);
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close() {
    this.readyState = Socket.CLOSED;
    this.onclose?.();
  }
}

class CaptureContext {
  state = "running";
  sampleRate = 16_000;
  destination = {};
  close = vi.fn(async () => undefined);
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createScriptProcessor() {
    const processor = {
      onaudioprocess: null as
        | ((event: {
            inputBuffer: { getChannelData: () => Float32Array };
          }) => void)
        | null,
      connect: () =>
        queueMicrotask(() =>
          processor.onaudioprocess?.({
            inputBuffer: { getChannelData: () => new Float32Array(1600) },
          }),
        ),
      disconnect: vi.fn(),
    };
    return processor;
  }
}

afterEach(() => {
  cancelSpeechFollowUp();
  releaseSharedSpeechMicStream();
  resetSpeechCaptureActivityForTests();
  localStorage.clear();
  document.body.replaceChildren();
  Socket.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function captureFixture() {
  vi.useFakeTimers();
  setBrowserXaiSttApiKey("test-key");
  const track = {
    readyState: "live",
    stop: vi.fn(() => {
      track.readyState = "ended";
    }),
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("AudioContext", CaptureContext);
  vi.stubGlobal("WebSocket", Socket);
  const media = document.createElement("audio");
  document.body.append(media);
  return { track, getUserMedia, media };
}

it("keeps the direct Grok mic and playback reduction across a Smart Turn handoff", async () => {
  const { track, getUserMedia, media } = captureFixture();
  const owner = {};
  const onResult = vi.fn((_text, metadata) => {
    if (metadata?.smartTurnCommand === "send") {
      armSpeechFollowUp(3000, owner, () => provider.stop());
    }
  });
  const provider = new DirectXaiStreamingSpeechProvider({
    keepMicWarm: false,
    temporarilyKeepMicWarm: () => true,
    smartTurn: {
      enabled: true,
      threshold: 0.95,
      timeoutMs: 3000,
      graceMs: 500,
    },
    onResult,
  });
  try {
    provider.start();
    await vi.waitFor(() => expect(provider.getState().isListening).toBe(true));
    const socket = Socket.instances[0]!;
    socket.receive({ type: "transcript.created" });
    socket.receive({
      type: "transcript.partial",
      text: "soft prompt",
      is_final: false,
    });
    expect(media.muted).toBe(true);
    socket.receive({
      type: "transcript.partial",
      text: "soft prompt tuning",
      is_final: true,
      speech_final: true,
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(provider.getState().isListening).toBe(true);
    expect(track.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(provider.getState().status).toBe("finalizing");
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "audio.done" }),
    );
    expect(track.stop).not.toHaveBeenCalled();
    expect(media.muted).toBe(true);
    socket.receive({ type: "transcript.done", text: "soft prompt tuning" });
    expect(onResult).toHaveBeenLastCalledWith("", {
      smartTurnCommand: "send",
      smartTurnAutoSend: true,
    });
    expect(track.stop).not.toHaveBeenCalled();
    provider.start();
    await vi.waitFor(() => expect(provider.getState().isListening).toBe(true));
    Socket.instances[1]!.receive({ type: "transcript.created" });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(media.muted).toBe(true);
    cancelSpeechFollowUp();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(media.muted).toBe(false);
  } finally {
    provider.dispose();
  }
});

it.each(["stop", "dispose", "disconnect", "timeout"] as const)(
  "releases the microphone handoff on %s without sending the draft",
  async (exit) => {
    const { track, media } = captureFixture();
    const onResult = vi.fn();
    const provider = new DirectXaiStreamingSpeechProvider({
      temporarilyKeepMicWarm: () => true,
      smartTurn: {
        enabled: true,
        threshold: 0.95,
        timeoutMs: 3000,
        graceMs: 0,
      },
      onResult,
    });
    try {
      provider.start();
      await vi.waitFor(() =>
        expect(provider.getState().isListening).toBe(true),
      );
      const socket = Socket.instances[0]!;
      socket.receive({ type: "transcript.created" });
      socket.receive({
        type: "transcript.partial",
        text: "a draft",
        is_final: true,
        speech_final: true,
      });
      expect(track.stop).not.toHaveBeenCalled();
      if (exit === "stop") provider.stop();
      if (exit === "dispose") provider.dispose();
      if (exit === "disconnect") socket.close();
      if (exit === "timeout") {
        await vi.advanceTimersByTimeAsync(5000);
        expect(provider.getState().status).toBe("idle");
      }
      expect(track.stop).toHaveBeenCalledOnce();
      expect(media.muted).toBe(false);
      if (exit === "stop") {
        socket.receive({ type: "transcript.done", text: "a draft" });
      }
      expect(onResult).toHaveBeenCalledOnce();
      expect(onResult).toHaveBeenCalledWith("a draft", undefined);
    } finally {
      provider.dispose();
    }
  },
);
