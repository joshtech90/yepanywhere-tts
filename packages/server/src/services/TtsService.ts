import { readFile, access } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { getLogger } from "../logging/logger.js";
import { CHUNKING_MIN_TOTAL_CHARS, splitIntoChunks } from "./ttsChunking.js";

const logger = getLogger();

/**
 * Text-to-speech. Three backends, tried in this order:
 *
 * 1. Grok read-aloud service (default since 2026-10-22, as in PocketClaude).
 *    A small HTTP service keeps a logged-in Grok web session and turns text
 *    into MP3 with a chosen voice: POST {url}/tts {"text","voice","lang",
 *    "format","stream"} -> audio/mpeg. Free, voice Leo by default.
 *    Config: TTS_GROK_URL (default http://127.0.0.1:8812),
 *            TTS_GROK_TOKEN_FILE (default ~/.config/grok-tts/token),
 *            TTS_GROK_VOICE (default leo).
 * 2. Gemini web read-aloud service, the same kind of service with one fixed
 *    voice: POST {url}/tts {"text","lang"} -> audio/ogg.
 *    Config: TTS_GEMINI_URL (default http://127.0.0.1:8811),
 *            TTS_GEMINI_TOKEN_FILE (default ~/.config/gemini-tts/token).
 * 3. Google Cloud Text-to-Speech, voice de-DE-Chirp3-HD-Algenib (MP3), used
 *    only when both services fail and a service-account JSON exists.
 *
 * On the machine that runs a service no auth is needed (loopback); other
 * machines send the bearer token from the token file.
 */

const VOICE_NAME = "de-DE-Chirp3-HD-Algenib";
const LANGUAGE_CODE = "de-DE";
const MAX_TEXT_LENGTH = 5000;
const WEB_MAX_TEXT_LENGTH = 20000;
const WEB_TIMEOUT_MS = 120_000;
const WEB_HEALTH_TTL_MS = 60_000;

export interface TtsAudio {
  audio: Buffer;
  mimeType: string;
}

export interface TtsServiceOptions {
  dataDir?: string;
  /** Explicit path to the Google service-account JSON. Overrides default. */
  serviceAccountPath?: string;
}

export type TtsBackend = "grok_web" | "gemini_web" | "google_cloud";

export interface TtsStatus {
  enabled: boolean;
  backend?: TtsBackend;
  credentialsPath?: string;
  error?: string;
}

/** One local read-aloud web service (Grok or Gemini) with a cached health. */
class WebReadAloud {
  private token: string | null = null;
  private healthy = false;
  private checkedAt = 0;
  /** Status and playback share the one pending health check. */
  private check: Promise<boolean> | null = null;

  constructor(
    readonly backend: "grok_web" | "gemini_web",
    readonly label: string,
    readonly url: string,
    private readonly tokenFile: string,
    private readonly mimeType: string,
    private readonly requestBody: (text: string) => Record<string, unknown>,
  ) {}

  async loadToken(): Promise<void> {
    try {
      const token = (await readFile(this.tokenFile, "utf-8")).trim();
      this.token = token || null;
    } catch {
      this.token = null; // loopback use needs no token
    }
  }

  get isHealthy(): boolean {
    return this.healthy;
  }

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  /** Health check, cached for a minute. Never throws. */
  checkHealth(force: boolean): Promise<boolean> {
    if (this.check) return this.check;
    if (!force && Date.now() - this.checkedAt < WEB_HEALTH_TTL_MS) {
      return Promise.resolve(this.healthy);
    }
    this.check = this.refreshHealth().finally(() => {
      this.checkedAt = Date.now();
      this.check = null;
    });
    return this.check;
  }

  private async refreshHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      this.healthy = res.ok && body.ok === true;
    } catch {
      this.healthy = false;
    }
    return this.healthy;
  }

  async synthesize(text: string): Promise<TtsAudio> {
    const res = await fetch(`${this.url}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers() },
      body: JSON.stringify(this.requestBody(text)),
      signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 503 || res.status === 401) this.healthy = false;
      throw new Error(`${this.label} read-aloud HTTP ${res.status}: ${detail}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new Error(`Empty audio from ${this.label}`);
    return { audio, mimeType: this.mimeType };
  }
}

function serviceUrl(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, "");
}

export class TtsService {
  private readonly dataDir?: string;
  private readonly explicitPath?: string;
  // Loaded lazily so the @google-cloud import only happens when used.
  private client: TextToSpeechClient | null = null;
  private resolvedCredentialsPath: string | null = null;
  private initError: string | null = null;
  private initialized = false;
  /** Free web services in order of preference: Grok, then Gemini. */
  private readonly services: WebReadAloud[];

  constructor(options: TtsServiceOptions = {}) {
    this.dataDir = options.dataDir;
    this.explicitPath =
      options.serviceAccountPath ?? process.env.TTS_SERVICE_ACCOUNT_PATH;
    const configDir = path.join(os.homedir(), ".config");
    const grokVoice = (process.env.TTS_GROK_VOICE || "leo")
      .trim()
      .toLowerCase();
    this.services = [
      new WebReadAloud(
        "grok_web",
        "Grok",
        serviceUrl(process.env.TTS_GROK_URL, "http://127.0.0.1:8812"),
        process.env.TTS_GROK_TOKEN_FILE ||
          path.join(configDir, "grok-tts", "token"),
        "audio/mpeg",
        // Chunks are planned here, so each one comes back as a whole file.
        (text) => ({
          text,
          voice: grokVoice,
          lang: "de",
          format: "mp3",
          stream: false,
        }),
      ),
      new WebReadAloud(
        "gemini_web",
        "Gemini",
        serviceUrl(process.env.TTS_GEMINI_URL, "http://127.0.0.1:8811"),
        process.env.TTS_GEMINI_TOKEN_FILE ||
          path.join(configDir, "gemini-tts", "token"),
        "audio/ogg",
        (text) => ({ text, lang: LANGUAGE_CODE }),
      ),
    ];
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await Promise.all(
      this.services.map(async (service) => {
        await service.loadToken();
        await service.checkHealth(true);
        logger.info(
          {
            component: "tts",
            backend: service.backend,
            url: service.url,
            healthy: service.isHealthy,
          },
          "Read-aloud service checked",
        );
      }),
    );

    const candidatePath = await this.findCredentialsPath();
    if (!candidatePath) {
      this.initError =
        "No Google service-account JSON found. Set TTS_SERVICE_ACCOUNT_PATH " +
        "or place tts-service-account.json in the data directory.";
      logger.warn({ component: "tts" }, this.initError);
      return;
    }

    try {
      const credentialsJson = await readFile(candidatePath, "utf-8");
      const credentials = JSON.parse(credentialsJson);
      const { TextToSpeechClient } = await import(
        "@google-cloud/text-to-speech"
      );
      this.client = new TextToSpeechClient({ credentials });
      this.resolvedCredentialsPath = candidatePath;
      logger.info(
        { component: "tts", voice: VOICE_NAME },
        "TTS initialized (Google Cloud, Chirp 3 HD)",
      );
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err);
      logger.error(
        { component: "tts", err: this.initError },
        "TTS initialization failed",
      );
    }
  }

  isReady(): boolean {
    return this.services.some((s) => s.isHealthy) || this.client !== null;
  }

  getStatus(): TtsStatus {
    // Refresh in the background so the status stays current without blocking.
    for (const service of this.services) void service.checkHealth(false);
    const web = this.services.find((s) => s.isHealthy);
    if (web) return { enabled: true, backend: web.backend };
    if (this.client) {
      return {
        enabled: true,
        backend: "google_cloud",
        credentialsPath: this.resolvedCredentialsPath ?? undefined,
      };
    }
    return { enabled: false, error: this.initError ?? "Not initialized" };
  }

  /**
   * Synthesize text to audio: Grok first, then Gemini, Google Cloud last.
   * Returns the bytes together with their MIME type (MP3 or Ogg/Opus).
   */
  async synthesizeAudio(text: string, preCleaned = false): Promise<TtsAudio> {
    const cleaned = preCleaned ? text : stripForTts(text);
    if (!cleaned) {
      throw new Error("Nothing to read aloud after cleaning the text");
    }
    let lastError: unknown = null;
    for (const service of this.services) {
      if (!(await service.checkHealth(false))) continue;
      try {
        return await service.synthesize(cleaned.slice(0, WEB_MAX_TEXT_LENGTH));
      } catch (err) {
        lastError = err;
        logger.warn(
          {
            component: "tts",
            backend: service.backend,
            err: err instanceof Error ? err.message : String(err),
          },
          "Read-aloud service failed, trying the next one",
        );
      }
    }
    if (!this.client) {
      if (lastError) throw lastError;
      throw new Error(
        this.initError ??
          "TTS not configured (read-aloud services unreachable)",
      );
    }
    return {
      audio: await this.synthesize(cleaned, true),
      mimeType: "audio/mpeg",
    };
  }

  /**
   * Synthesize text to an MP3 buffer. Throws on error.
   *
   * @param preCleaned set when the caller already cleaned/chunked the text
   *   (e.g. a single chunk from planChunks) so we don't strip markdown twice.
   */
  async synthesize(text: string, preCleaned = false): Promise<Buffer> {
    if (!this.client) {
      throw new Error(this.initError ?? "TTS not configured");
    }
    const cleaned = preCleaned
      ? text.slice(0, MAX_TEXT_LENGTH)
      : stripForTts(text).slice(0, MAX_TEXT_LENGTH);
    if (!cleaned) {
      throw new Error("Nothing to read aloud after cleaning the text");
    }

    logger.info(
      { component: "tts", chars: cleaned.length, voice: VOICE_NAME },
      "TTS synthesizing",
    );
    const [response] = await this.client.synthesizeSpeech({
      input: { text: cleaned },
      voice: { languageCode: LANGUAGE_CODE, name: VOICE_NAME },
      audioConfig: { audioEncoding: "MP3" },
    });
    const audio = response.audioContent;
    if (!audio) {
      throw new Error("Empty audio response from Google TTS");
    }
    return typeof audio === "string"
      ? Buffer.from(audio, "base64")
      : Buffer.from(audio);
  }

  /**
   * Clean and split text into ordered chunks for fast-start playback. The
   * first chunk is short so the client can start speaking almost immediately;
   * remaining chunks are balanced. Returns [] if there is nothing to read.
   */
  planChunks(text: string): string[] {
    const limit = this.services.some((s) => s.isHealthy)
      ? WEB_MAX_TEXT_LENGTH
      : MAX_TEXT_LENGTH;
    const cleaned = stripForTts(text).slice(0, limit);
    if (!cleaned) return [];
    if (cleaned.length < CHUNKING_MIN_TOTAL_CHARS) return [cleaned];
    const chunks = splitIntoChunks(cleaned);
    return chunks.length ? chunks : [cleaned];
  }

  private async findCredentialsPath(): Promise<string | null> {
    const candidates: string[] = [];
    if (this.explicitPath) candidates.push(this.explicitPath);
    if (this.dataDir)
      candidates.push(path.join(this.dataDir, "tts-service-account.json"));
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // try next
      }
    }
    return null;
  }
}

/**
 * Strip markdown/code/URLs/emojis so the voice doesn't read backticks, raw
 * URLs or symbols. Mirrors strip_for_tts() from the PocketClaude tts_engine.
 */
export function stripForTts(input: string): string {
  let text = input;
  // Fenced code blocks
  text = text.replace(/```[\s\S]*?```/g, " ");
  // Inline code
  text = text.replace(/`[^`]*`/g, " ");
  // Images ![alt](url) and links [text](url) -> keep the visible text
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Bare URLs
  text = text.replace(/https?:\/\/\S+/g, " ");
  // Markdown emphasis / headings markers
  text = text.replace(/[*_#>]+/g, " ");
  // Emojis and pictographs
  text = text.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
    " ",
  );
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}
