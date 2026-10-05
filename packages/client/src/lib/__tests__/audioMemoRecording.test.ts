import { Blob, File } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioMemoRecording, encodeAudioMemoWav } from "../audioMemoRecording";

afterEach(() => vi.unstubAllGlobals());

describe("audio memo recording", () => {
  it("writes a standard mono 24 kHz PCM16 WAV with clipped signed samples", async () => {
    vi.stubGlobal("Blob", Blob);
    const wav = encodeAudioMemoWav(new Float32Array([-2, -0.5, 0, 0.5, 2]));
    const data = new DataView(await wav.arrayBuffer());
    expect(new TextDecoder().decode(new Uint8Array(data.buffer, 0, 4))).toBe(
      "RIFF",
    );
    expect(data.getUint32(4, true)).toBe(46);
    expect(data.getUint16(20, true)).toBe(1);
    expect(data.getUint16(22, true)).toBe(1);
    expect(data.getUint32(24, true)).toBe(24000);
    expect(data.getUint16(34, true)).toBe(16);
    expect(data.getUint32(40, true)).toBe(10);
    expect(
      Array.from({ length: 5 }, (_, i) => data.getInt16(44 + i * 2, true)),
    ).toEqual([-32768, -16384, 0, 16384, 32767]);
  });

  it("captures real processor frames, copies reused buffers, and releases the mic on stop", async () => {
    vi.stubGlobal("Blob", Blob);
    vi.stubGlobal("File", File);
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop, onended: null }] };
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const processor = {
      onaudioprocess: null as
        | null
        | ((event: {
            inputBuffer: { getChannelData: () => Float32Array };
          }) => void),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const close = vi.fn(async () => {});
    vi.stubGlobal(
      "AudioContext",
      class {
        sampleRate = 24000;
        destination = {};
        resume = async () => {};
        close = close;
        createMediaStreamSource = () => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        createScriptProcessor = () => processor;
        createGain = () => ({
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
      },
    );
    const recording = new AudioMemoRecording();
    const onSamples = vi.fn();
    await recording.start({
      micDeviceId: "chosen",
      reducePlayback: false,
      onSamples,
      onInterrupted: vi.fn(),
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        deviceId: { exact: "chosen" },
        sampleRate: { ideal: 24000 },
        channelCount: { ideal: 1 },
      }),
    });
    const samples = new Float32Array([0.5, -0.5]);
    processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => samples },
    });
    samples.fill(0);
    const file = await recording.finish();
    expect(file.type).toBe("audio/wav");
    const data = new DataView(await file.arrayBuffer());
    expect(data.getInt16(44, true)).toBe(16384);
    expect(data.getInt16(46, true)).toBe(-16384);
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(processor.onaudioprocess).toBeNull();
    expect(onSamples).toHaveBeenCalledOnce();
  });
});
