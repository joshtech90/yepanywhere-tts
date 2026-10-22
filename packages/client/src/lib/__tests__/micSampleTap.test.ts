// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../storageKeys";
import {
  connectMicSampleTap,
  PCM_TAP_PROCESSOR_SOURCE,
} from "../speechProviders/micSampleTap";

interface TapProcessor {
  port: { postMessage: ReturnType<typeof vi.fn>; onmessage: () => void };
  process(inputs: Float32Array[][]): boolean;
}

function loadTapProcessor(batchSize: number): TapProcessor {
  let ProcessorClass: (new (options: unknown) => TapProcessor) | undefined;
  class FakeAudioWorkletProcessor {
    port = { postMessage: vi.fn(), onmessage: () => {} };
  }
  new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    PCM_TAP_PROCESSOR_SOURCE,
  )(
    FakeAudioWorkletProcessor,
    (_name: string, cls: new (options: unknown) => TapProcessor) => {
      ProcessorClass = cls;
    },
  );
  if (!ProcessorClass) throw new Error("processor was not registered");
  return new ProcessorClass({ processorOptions: { batchSize } });
}

function quantum(start: number): Float32Array {
  return Float32Array.from({ length: 128 }, (_, i) => start + i);
}

function fakeNode() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function fakeContext(addModule?: () => Promise<void>) {
  const processor = {
    ...fakeNode(),
    onaudioprocess: null as ((event: unknown) => void) | null,
  };
  return {
    processor,
    context: {
      destination: {},
      createGain: () => ({ ...fakeNode(), gain: { value: 1 } }),
      createScriptProcessor: vi.fn(() => processor),
      ...(addModule ? { audioWorklet: { addModule: vi.fn(addModule) } } : {}),
    } as unknown as BaseAudioContext,
  };
}

describe("PCM tap worklet processor", () => {
  it("re-batches render quanta into ordered fixed-size batches", () => {
    const processor = loadTapProcessor(256);
    for (let q = 0; q < 5; q += 1) {
      expect(processor.process([[quantum(q * 128)]])).toBe(true);
    }
    const posted = processor.port.postMessage.mock.calls.map(
      (call) => call[0] as Float32Array,
    );
    expect(posted).toHaveLength(2);
    expect(Array.from(posted[0] ?? [])).toEqual(
      Array.from({ length: 256 }, (_, i) => i),
    );
    expect(posted[1]?.[0]).toBe(256);
    expect(posted[1]?.[255]).toBe(511);
  });

  it("waits through inputless quanta and ends once stopped", () => {
    const processor = loadTapProcessor(256);
    expect(processor.process([[]])).toBe(true);
    processor.port.onmessage();
    expect(processor.process([[quantum(0)]])).toBe(false);
    expect(processor.port.postMessage).not.toHaveBeenCalled();
  });
});

describe("connectMicSampleTap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(UI_KEYS.speechAudioWorklet);
  });

  function stubWorkletNode() {
    const created: { port: { onmessage: ((e: unknown) => void) | null } }[] =
      [];
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        port = { onmessage: null, postMessage: vi.fn() };
        connect = vi.fn();
        disconnect = vi.fn();
        constructor() {
          created.push(this);
        }
      },
    );
    return created;
  }

  it("delivers worklet batches by default", async () => {
    const created = stubWorkletNode();
    const { context } = fakeContext(async () => undefined);
    const onSamples = vi.fn();
    const tap = await connectMicSampleTap(context, fakeNode() as never, {
      batchSize: 1024,
      onSamples,
    });
    expect(tap.mode).toBe("worklet");
    const batch = new Float32Array(1024);
    created[0]?.port.onmessage?.({ data: batch });
    expect(onSamples).toHaveBeenCalledWith(batch);
    tap.disconnect();
    expect(created[0]?.port.onmessage).toBeNull();
  });

  it("uses ScriptProcessor when the setting is off or the module fails", async () => {
    stubWorkletNode();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(UI_KEYS.speechAudioWorklet, "false");
    const off = fakeContext(async () => undefined);
    const offTap = await connectMicSampleTap(off.context, fakeNode() as never, {
      batchSize: 1024,
      onSamples: vi.fn(),
    });
    expect(offTap.mode).toBe("script-processor");

    localStorage.removeItem(UI_KEYS.speechAudioWorklet);
    const failing = fakeContext(async () => {
      throw new Error("blocked by CSP");
    });
    const onSamples = vi.fn();
    const failTap = await connectMicSampleTap(
      failing.context,
      fakeNode() as never,
      { batchSize: 1024, onSamples },
    );
    expect(failTap.mode).toBe("script-processor");
    const samples = new Float32Array(1024);
    failing.processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => samples },
    });
    expect(onSamples).toHaveBeenCalledWith(samples);
  });
});
