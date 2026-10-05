import { DirectXaiStreamingSpeechProvider } from "./speechProviders/DirectXaiStreamingSpeechProvider";
import { postDirectXaiStt } from "./speechProviders/DirectXaiSpeechProvider";
import {
  YaServerProvider,
  transcribeSpeechAudio,
} from "./speechProviders/YaServerProvider";
import type {
  SpeechProvider,
  SpeechProviderOptions,
} from "./speechProviders/SpeechProvider";
import {
  XAI_DIRECT_STREAMING_SPEECH_METHOD,
  XAI_DIRECT_BATCH_SPEECH_METHOD,
  getServerBackendIdForSpeechMethod,
} from "./speechProviders/methods";
import { getXaiSttCredential } from "./speechProviders/xaiCredentials";
import { appendSpeechTranscript } from "./speechRecognition";

export interface AudioMemoTranscriptionPlan {
  method: string;
  streaming: boolean;
  basePath: string;
  options: SpeechProviderOptions;
}

/** A disposable ASR subscriber; it never owns the memo's recording tracks. */
export class AudioMemoTranscript {
  private provider: SpeechProvider | null = null;
  private transcript = "";
  private failure: Error | null = null;
  private disposed = false;
  private settled: (() => void) | null = null;
  private completed = false;
  private cancelResult: (() => void) | null = null;
  private readonly cancelled = new Promise<string>((resolve) => {
    this.cancelResult = () => resolve("");
  });

  constructor(private readonly plan: AudioMemoTranscriptionPlan) {}

  startPreview(
    stream: MediaStream,
    onPreview: (text: string) => void,
    onError: (message: string) => void,
  ): void {
    if (!this.plan.streaming) return;
    const options: SpeechProviderOptions = {
      ...this.plan.options,
      serverStreaming: true,
      smartTurn: undefined,
      acquireAudioStream: async () => stream.clone(),
      onResult: (text, metadata) => {
        if (this.disposed) return;
        const remove = metadata?.replacePreviousTranscriptChars ?? 0;
        this.transcript = appendSpeechTranscript(
          remove ? this.transcript.slice(0, -remove) : this.transcript,
          text,
        );
        onPreview(this.transcript);
      },
      onInterimResult: (text) => {
        if (!this.disposed)
          onPreview(appendSpeechTranscript(this.transcript, text));
      },
      onEnd: () => {
        this.completed = true;
        this.settled?.();
      },
      onError: (message) => {
        this.failure = new Error(message);
        this.completed = true;
        this.settled?.();
        if (!this.disposed) onError(message);
      },
    };
    this.provider =
      this.plan.method === XAI_DIRECT_STREAMING_SPEECH_METHOD
        ? new DirectXaiStreamingSpeechProvider(options)
        : new YaServerProvider(
            getServerBackendIdForSpeechMethod(this.plan.method),
            this.plan.basePath,
            options,
          );
    this.provider.start();
  }

  async finish(audio: Blob): Promise<string> {
    if (this.disposed) return "";
    if (this.provider) {
      const provider = this.provider;
      if (!this.completed) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Audio memo transcription timed out")),
            30_000,
          );
          this.settled = () => {
            clearTimeout(timeout);
            resolve();
          };
          provider.stop();
        });
      }
      if (this.disposed) return "";
      if (this.failure) throw this.failure;
      return this.transcript;
    }
    const { method, options } = this.plan;
    const request =
      method === XAI_DIRECT_STREAMING_SPEECH_METHOD ||
      method === XAI_DIRECT_BATCH_SPEECH_METHOD
        ? getXaiSttCredential().then((credential) =>
            postDirectXaiStt(audio, credential),
          )
        : transcribeSpeechAudio(
            audio,
            getServerBackendIdForSpeechMethod(method),
            options,
          ).then((response) => response.text);
    const result = await Promise.race([request, this.cancelled]);
    return this.disposed ? "" : result;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelResult?.();
    this.provider?.dispose();
    this.provider = null;
    this.transcript = "";
    this.settled?.();
  }
}
