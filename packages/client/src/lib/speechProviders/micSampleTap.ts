/**
 * Microphone sample tap shared by every YA Web Audio capture path: it pulls
 * mono Float32 batches from a MediaStream source and hands them to the main
 * thread. AudioWorklet mode pulls on the audio rendering thread, so a
 * main-thread stall delays batches instead of dropping them; the deprecated
 * ScriptProcessorNode remains the fallback wherever the worklet is missing or
 * its module fails to load. See topics/streaming-speech-capture.md
 * § Capture modes.
 */

import { UI_KEYS } from "../storageKeys";

export type MicCaptureMode = "worklet" | "script-processor";

/** Browser-local, default on: "false" forces ScriptProcessor capture. */
export function getSpeechAudioWorkletSetting(): boolean {
  try {
    return (
      globalThis.localStorage?.getItem(UI_KEYS.speechAudioWorklet) !== "false"
    );
  } catch {
    return true;
  }
}

export interface MicSampleTap {
  mode: MicCaptureMode;
  disconnect(): void;
}

const PCM_TAP_PROCESSOR = "ya-pcm-tap";

// Plain JS evaluated in the AudioWorkletGlobalScope. Loaded from a blob URL so
// local and hosted builds need no separate asset; the app CSP allows blob:
// scripts. Each posted batch is a fresh buffer transferred to the main thread.
export const PCM_TAP_PROCESSOR_SOURCE = `
class YaPcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.batchSize = options.processorOptions.batchSize;
    this.batch = new Float32Array(this.batchSize);
    this.filled = 0;
    this.stopped = false;
    this.port.onmessage = () => { this.stopped = true; };
  }
  process(inputs) {
    if (this.stopped) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, this.batchSize - this.filled);
      this.batch.set(channel.subarray(offset, offset + count), this.filled);
      this.filled += count;
      offset += count;
      if (this.filled === this.batchSize) {
        this.port.postMessage(this.batch, [this.batch.buffer]);
        this.batch = new Float32Array(this.batchSize);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(PCM_TAP_PROCESSOR)}, YaPcmTapProcessor);
`;

const preparedContexts = new WeakMap<BaseAudioContext, Promise<boolean>>();
let moduleUrl: string | null = null;

// Actionable: an enabled worklet that falls back on a device is the evidence
// for whether that browser can use the worklet path at all.
function warnWorkletFallback(reason: string, error: unknown): void {
  console.warn(
    `[YaAudio] AudioWorklet ${reason}; using ScriptProcessor capture`,
    error,
  );
}

function workletSupported(context: BaseAudioContext): boolean {
  return (
    typeof AudioWorkletNode !== "undefined" &&
    typeof context.audioWorklet?.addModule === "function" &&
    typeof Blob !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

/**
 * Start loading the tap worklet into `context` so a later
 * `connectMicSampleTap` need not wait for it. Resolves to whether worklet mode
 * is enabled and usable in this context; never rejects.
 */
export function prepareMicSampleTap(
  context: BaseAudioContext,
): Promise<boolean> {
  // Not cached: a long-lived context must follow a later setting change.
  if (!getSpeechAudioWorkletSetting()) return Promise.resolve(false);
  const prepared = preparedContexts.get(context);
  if (prepared) return prepared;
  let loading: Promise<boolean>;
  if (!workletSupported(context)) {
    loading = Promise.resolve(false);
  } else {
    moduleUrl ??= URL.createObjectURL(
      new Blob([PCM_TAP_PROCESSOR_SOURCE], { type: "text/javascript" }),
    );
    loading = context.audioWorklet.addModule(moduleUrl).then(
      () => true,
      (error: unknown) => {
        warnWorkletFallback("module failed to load", error);
        return false;
      },
    );
  }
  preparedContexts.set(context, loading);
  return loading;
}

function connectThroughSilentGain(
  context: BaseAudioContext,
  source: AudioNode,
  node: AudioNode,
): GainNode {
  // A capture node must reach the destination to be pulled; zero gain keeps
  // the microphone out of the speakers.
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  source.connect(node);
  node.connect(silentGain);
  silentGain.connect(context.destination);
  return silentGain;
}

/**
 * Tap `source` and deliver channel-0 batches of `batchSize` samples to
 * `onSamples`, in worklet mode unless the setting is off or unusable here.
 * `batchSize` must be a ScriptProcessor buffer size (a power of two from 256
 * to 16384) so both modes deliver the same batch shape.
 */
export async function connectMicSampleTap(
  context: BaseAudioContext,
  source: AudioNode,
  {
    batchSize,
    onSamples,
  }: {
    batchSize: number;
    onSamples: (samples: Float32Array) => void;
  },
): Promise<MicSampleTap> {
  let node: AudioWorkletNode | null = null;
  if (await prepareMicSampleTap(context)) {
    try {
      node = new AudioWorkletNode(context, PCM_TAP_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: { batchSize },
      });
    } catch (error) {
      warnWorkletFallback("node construction failed", error);
    }
  }

  if (node) {
    const workletNode = node;
    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      onSamples(event.data);
    };
    return tapThrough(context, source, workletNode, "worklet", () => {
      workletNode.port.onmessage = null;
      // Lets the processor return false; closing the port here could drop
      // this message before it is delivered.
      workletNode.port.postMessage("stop");
    });
  }

  const processor = context.createScriptProcessor(batchSize, 1, 1);
  processor.onaudioprocess = (event) => {
    onSamples(event.inputBuffer.getChannelData(0));
  };
  return tapThrough(context, source, processor, "script-processor", () => {
    processor.onaudioprocess = null;
  });
}

function tapThrough(
  context: BaseAudioContext,
  source: AudioNode,
  node: AudioNode,
  mode: MicCaptureMode,
  stopDelivery: () => void,
): MicSampleTap {
  const silentGain = connectThroughSilentGain(context, source, node);
  let connected = true;
  return {
    mode,
    disconnect: () => {
      if (!connected) return;
      connected = false;
      stopDelivery();
      // The caller owns `source` and disconnects it.
      node.disconnect();
      silentGain.disconnect();
    },
  };
}
