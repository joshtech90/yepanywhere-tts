import { setSpeechCaptureActivity } from "./speechCaptureActivity";
import {
  speechMicConstraints,
  releaseSharedSpeechMicStream,
  stopSpeechStreamTracks,
} from "./speechProviders/sharedMicCapture";

export const AUDIO_MEMO_SAMPLE_RATE = 24_000;
export const AUDIO_MEMO_MAX_SECONDS = 600;

/** Encode mono audio as a 24 kHz signed PCM16 WAV attachment. */
export function encodeAudioMemoWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, AUDIO_MEMO_SAMPLE_RATE, true);
  view.setUint32(28, AUDIO_MEMO_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(
      44 + i * 2,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true,
    );
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Owns an audio memo capture independently of any transcription subscriber. */
export class AudioMemoRecording {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private gain: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleCount = 0;
  private sampleRate = AUDIO_MEMO_SAMPLE_RATE;
  private closed = false;

  async start(options: {
    micDeviceId: string | null;
    reducePlayback: boolean;
    onSamples: (samples: Float32Array, seconds: number) => void;
    onInterrupted: () => void;
  }): Promise<MediaStream> {
    releaseSharedSpeechMicStream();
    this.context = new AudioContext({ sampleRate: AUDIO_MEMO_SAMPLE_RATE });
    try {
      await this.context.resume();
      if (this.closed) throw new Error("Audio memo recording cancelled");
      const constraints = speechMicConstraints(
        options.micDeviceId,
        options.reducePlayback,
      );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(constraints.audio as MediaTrackConstraints),
          sampleRate: { ideal: AUDIO_MEMO_SAMPLE_RATE },
        },
      });
      if (this.closed) {
        stopSpeechStreamTracks(stream);
        throw new Error("Audio memo recording cancelled");
      }
      this.stream = stream;
      if (options.reducePlayback) setSpeechCaptureActivity(stream, "capturing");
      for (const track of stream.getTracks())
        track.onended = options.onInterrupted;
      if (this.closed || !this.context)
        throw new Error("Audio memo recording cancelled");
      this.sampleRate = this.context.sampleRate;
      this.source = this.context.createMediaStreamSource(stream);
      this.processor = this.context.createScriptProcessor(2048, 1, 1);
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.processor.onaudioprocess = (event) => {
        if (this.closed) return;
        const samples = event.inputBuffer.getChannelData(0);
        if (
          this.sampleCount + samples.length >
          this.sampleRate * AUDIO_MEMO_MAX_SECONDS
        ) {
          options.onInterrupted();
          return;
        }
        this.chunks.push(samples.slice());
        this.sampleCount += samples.length;
        options.onSamples(samples, this.sampleCount / this.sampleRate);
      };
      this.source.connect(this.processor);
      this.processor.connect(this.gain);
      this.gain.connect(this.context.destination);
      return stream;
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  private close(): void {
    this.closed = true;
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.gain?.disconnect();
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.onended = null;
      stopSpeechStreamTracks(this.stream);
    }
    if (this.context) void this.context.close();
    this.context = null;
    this.stream = null;
  }

  cancel(): void {
    this.close();
    this.chunks = [];
    this.sampleCount = 0;
  }

  async finish(): Promise<File> {
    this.close();
    if (this.sampleCount === 0)
      throw new Error("Audio memo contains no audio frames");
    let samples = new Float32Array(this.sampleCount);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    if (this.sampleRate !== AUDIO_MEMO_SAMPLE_RATE) {
      const offline = new OfflineAudioContext(
        1,
        Math.ceil((samples.length * AUDIO_MEMO_SAMPLE_RATE) / this.sampleRate),
        AUDIO_MEMO_SAMPLE_RATE,
      );
      const input = offline.createBuffer(1, samples.length, this.sampleRate);
      input.copyToChannel(samples, 0);
      const source = offline.createBufferSource();
      source.buffer = input;
      source.connect(offline.destination);
      source.start();
      samples = new Float32Array(
        (await offline.startRendering()).getChannelData(0),
      );
    }
    return new File(
      [encodeAudioMemoWav(samples)],
      `audio-memo-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`,
      { type: "audio/wav" },
    );
  }
}
