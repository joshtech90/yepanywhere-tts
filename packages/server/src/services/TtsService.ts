import { readFile, access } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { getLogger } from "../logging/logger.js";
import { CHUNKING_MIN_TOTAL_CHARS, splitIntoChunks } from "./ttsChunking.js";

const logger = getLogger();

/**
 * Text-to-speech. Two backends, tried in this order:
 *
 * 1. Gemini web read-aloud service (default since 2026-09-23). A small HTTP
 *    service keeps a logged-in Gemini web session and turns text into
 *    Ogg/Opus: POST {url}/tts {"text","lang"} -> audio/ogg. Free, ~40x faster
 *    than real time, one fixed voice. On the machine that runs it no auth is
 *    needed (loopback); other machines send a bearer token.
 *    Config: TTS_GEMINI_URL (default http://127.0.0.1:8811),
 *            TTS_GEMINI_TOKEN_FILE (default ~/.config/gemini-tts/token).
 * 2. Google Cloud Text-to-Speech, voice de-DE-Chirp3-HD-Algenib (MP3), used
 *    when the Gemini service is unreachable and a service-account JSON exists.
 */

const VOICE_NAME = "de-DE-Chirp3-HD-Algenib";
const LANGUAGE_CODE = "de-DE";
const MAX_TEXT_LENGTH = 5000;
const GEMINI_MAX_TEXT_LENGTH = 20000;
const GEMINI_DEFAULT_URL = "http://127.0.0.1:8811";
const GEMINI_TIMEOUT_MS = 120_000;
const GEMINI_HEALTH_TTL_MS = 60_000;

export interface TtsAudio {
  audio: Buffer;
  mimeType: string;
}

export interface TtsServiceOptions {
  dataDir?: string;
  /** Explicit path to the Google service-account JSON. Overrides default. */
  serviceAccountPath?: string;
}

export interface TtsStatus {
  enabled: boolean;
  backend?: "gemini_web" | "google_cloud";
  credentialsPath?: string;
  error?: string;
}

export class TtsService {
  private readonly dataDir?: string;
  private readonly explicitPath?: string;
  // Loaded lazily so the @google-cloud import only happens when used.
  private client: TextToSpeechClient | null = null;
  private resolvedCredentialsPath: string | null = null;
  private initError: string | null = null;
  private initialized = false;
  private readonly geminiUrl: string;
  private readonly geminiTokenFile: string;
  private geminiToken: string | null = null;
  private geminiHealthy = false;
  private geminiCheckedAt = 0;

  constructor(options: TtsServiceOptions = {}) {
    this.dataDir = options.dataDir;
    this.explicitPath =
      options.serviceAccountPath ?? process.env.TTS_SERVICE_ACCOUNT_PATH;
    this.geminiUrl = (process.env.TTS_GEMINI_URL || GEMINI_DEFAULT_URL).replace(
      /\/+$/,
      "",
    );
    this.geminiTokenFile =
      process.env.TTS_GEMINI_TOKEN_FILE ||
      path.join(os.homedir(), ".config", "gemini-tts", "token");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const token = (await readFile(this.geminiTokenFile, "utf-8")).trim();
      this.geminiToken = token || null;
    } catch {
      this.geminiToken = null; // loopback use needs no token
    }
    await this.checkGemini(true);
    logger.info(
      { component: "tts", url: this.geminiUrl, healthy: this.geminiHealthy },
      "Gemini read-aloud service checked",
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
    return this.geminiHealthy || this.client !== null;
  }

  getStatus(): TtsStatus {
    // Refresh in the background so the status stays current without blocking.
    void this.checkGemini(false);
    if (this.geminiHealthy) {
      return { enabled: true, backend: "gemini_web" };
    }
    if (this.client) {
      return {
        enabled: true,
        backend: "google_cloud",
        credentialsPath: this.resolvedCredentialsPath ?? undefined,
      };
    }
    return { enabled: false, error: this.initError ?? "Not initialized" };
  }

  private geminiHeaders(): Record<string, string> {
    return this.geminiToken
      ? { Authorization: `Bearer ${this.geminiToken}` }
      : {};
  }

  /** Health check of the Gemini service, cached for a minute. Never throws. */
  private async checkGemini(force: boolean): Promise<boolean> {
    const now = Date.now();
    if (!force && now - this.geminiCheckedAt < GEMINI_HEALTH_TTL_MS) {
      return this.geminiHealthy;
    }
    this.geminiCheckedAt = now;
    try {
      const res = await fetch(`${this.geminiUrl}/health`, {
        headers: this.geminiHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      this.geminiHealthy = res.ok && body.ok === true;
    } catch {
      this.geminiHealthy = false;
    }
    return this.geminiHealthy;
  }

  private async synthesizeGemini(text: string): Promise<Buffer> {
    const res = await fetch(`${this.geminiUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.geminiHeaders() },
      body: JSON.stringify({ text, lang: LANGUAGE_CODE }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 503 || res.status === 401) this.geminiHealthy = false;
      throw new Error(`Gemini read-aloud HTTP ${res.status}: ${detail}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new Error("Empty audio from Gemini read-aloud");
    return audio;
  }

  /**
   * Synthesize text to audio, Gemini first, Google Cloud as fallback.
   * Returns the bytes together with their MIME type (Ogg/Opus or MP3).
   */
  async synthesizeAudio(text: string, preCleaned = false): Promise<TtsAudio> {
    const cleaned = preCleaned ? text : stripForTts(text);
    if (!cleaned) {
      throw new Error("Nothing to read aloud after cleaning the text");
    }
    let geminiError: unknown = null;
    if (await this.checkGemini(false)) {
      try {
        const audio = await this.synthesizeGemini(
          cleaned.slice(0, GEMINI_MAX_TEXT_LENGTH),
        );
        return { audio, mimeType: "audio/ogg" };
      } catch (err) {
        geminiError = err;
        logger.warn(
          {
            component: "tts",
            err: err instanceof Error ? err.message : String(err),
          },
          "Gemini read-aloud failed, trying Google Cloud",
        );
      }
    }
    if (!this.client) {
      if (geminiError) throw geminiError;
      throw new Error(
        this.initError ?? "TTS not configured (Gemini service unreachable)",
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
    const limit = this.geminiHealthy ? GEMINI_MAX_TEXT_LENGTH : MAX_TEXT_LENGTH;
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
