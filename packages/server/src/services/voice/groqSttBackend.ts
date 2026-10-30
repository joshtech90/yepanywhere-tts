import { getLogger } from "../../logging/logger.js";
import type { SpeechBackend, TranscribeOptions } from "./SpeechBackend.js";

const logger = getLogger();

const TRANSCRIPTIONS_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";
/** Groq's free tier rejects uploads above 25 MB; stay clearly below it. */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
/** Fallback cool-down for a rate-limited key when Groq names no retry-after. */
const DEFAULT_COOLDOWN_MS = 60_000;

interface GroqTranscriptionResponse {
  text?: string;
}

/** Groq infers the container from the file name, not the part's MIME type. */
function fileNameFor(mimeType: string): string {
  const type = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.endsWith("/mp4") || type.endsWith("/m4a")) return "audio.m4a";
  if (type.endsWith("/ogg")) return "audio.ogg";
  if (type.endsWith("/wav") || type.endsWith("/x-wav")) return "audio.wav";
  if (type.endsWith("/mpeg") || type.endsWith("/mp3")) return "audio.mp3";
  if (type.endsWith("/flac")) return "audio.flac";
  return "audio.webm";
}

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_COOLDOWN_MS;
}

/**
 * Groq Whisper cloud backend (batch, OpenAI-compatible endpoint).
 *
 * Accepts a pool of keys: every request starts at a random key, and a key that
 * answers 401/403/429 hands the request to the next one. Rate-limited keys
 * rest until their retry-after, so a busy free-tier key is skipped instead of
 * retried on every utterance.
 */
export class GroqSttBackend implements SpeechBackend {
  readonly id = "ya-groq";
  readonly label = "Groq Whisper (cloud)";

  private readonly restingUntil = new Map<string, number>();

  constructor(
    private readonly apiKeys: readonly string[],
    private readonly language?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async validate(): Promise<{ ok: true } | { ok: false; reason: string }> {
    // Probing ten keys on every start costs quota and startup time; presence
    // is the enable signal and a bad key surfaces on the first utterance.
    return this.apiKeys.length > 0
      ? { ok: true }
      : { ok: false, reason: "No Groq API key configured" };
  }

  private isResting(key: string): boolean {
    return (this.restingUntil.get(key) ?? 0) > Date.now();
  }

  /** Keys in try order from a random start; resting keys are left out. */
  private keyOrder(): string[] {
    const start = Math.floor(Math.random() * this.apiKeys.length);
    return [
      ...this.apiKeys.slice(start),
      ...this.apiKeys.slice(0, start),
    ].filter((key) => !this.isResting(key));
  }

  /**
   * Groq's error text is shown to the user and logged by the speech route, so
   * only its `error.message` survives, bounded and with every pool key masked.
   */
  private describeFailure(status: number, body: string): string {
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown } };
      if (typeof parsed.error?.message === "string") {
        detail = parsed.error.message;
      }
    } catch {
      // Not JSON; keep the raw text.
    }
    for (const key of this.apiKeys) detail = detail.split(key).join("[key]");
    detail = detail.replace(/gsk_[A-Za-z0-9]+/g, "[key]").slice(0, 200);
    return `Groq transcription failed (HTTP ${status})${detail ? `: ${detail}` : ""}`;
  }

  async transcribe(
    audio: Buffer,
    options: TranscribeOptions = {},
  ): Promise<string> {
    if (audio.length > MAX_AUDIO_BYTES) {
      throw new Error("Recording is too long for Groq (25 MB limit)");
    }
    const mimeType = options.mimeType ?? "audio/webm;codecs=opus";
    const bytes = audio.buffer.slice(
      audio.byteOffset,
      audio.byteOffset + audio.byteLength,
    ) as ArrayBuffer;

    const order = this.keyOrder();
    if (order.length === 0) {
      const wakeAt = Math.min(...this.restingUntil.values());
      const seconds = Math.max(1, Math.ceil((wakeAt - Date.now()) / 1000));
      throw new Error(
        `All Groq keys are rate-limited; try again in ${seconds} s`,
      );
    }
    let lastError = "All Groq keys are rate-limited";
    for (const key of order) {
      // A parallel request may have rate-limited this key meanwhile.
      if (this.isResting(key)) continue;
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: mimeType }),
        fileNameFor(mimeType),
      );
      form.append("model", options.model || DEFAULT_MODEL);
      form.append("response_format", "json");
      form.append("temperature", "0");
      if (this.language) form.append("language", this.language);
      if (options.prompt) form.append("prompt", options.prompt.slice(-800));

      const res = await this.fetchImpl(TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const data = (await res.json()) as GroqTranscriptionResponse;
        const transcript = (data.text ?? "").trim();
        logger.debug(`Groq transcript: ${transcript.length} chars`);
        return transcript;
      }

      const body = await res.text().catch(() => "");
      lastError = this.describeFailure(res.status, body);
      if (res.status === 429) {
        this.restingUntil.set(key, Date.now() + retryAfterMs(res));
        continue;
      }
      if (res.status === 401 || res.status === 403) continue;
      break;
    }
    throw new Error(lastError);
  }
}
