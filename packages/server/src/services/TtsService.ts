import { readFile, access } from "node:fs/promises";
import * as path from "node:path";
import type { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { getLogger } from "../logging/logger.js";
import {
  CHUNKING_MIN_TOTAL_CHARS,
  splitIntoChunks,
} from "./ttsChunking.js";

const logger = getLogger();

/**
 * Text-to-speech via Google Cloud Text-to-Speech.
 *
 * Single fixed voice (de-DE-Chirp3-HD-Algenib, male). Ported from the
 * PocketClaude tts_engine; intentionally minimal — one voice, MP3 output,
 * no model picker.
 */

const VOICE_NAME = "de-DE-Chirp3-HD-Algenib";
const LANGUAGE_CODE = "de-DE";
const MAX_TEXT_LENGTH = 5000;

export interface TtsServiceOptions {
  dataDir?: string;
  /** Explicit path to the Google service-account JSON. Overrides default. */
  serviceAccountPath?: string;
}

export interface TtsStatus {
  enabled: boolean;
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

  constructor(options: TtsServiceOptions = {}) {
    this.dataDir = options.dataDir;
    this.explicitPath =
      options.serviceAccountPath ?? process.env.TTS_SERVICE_ACCOUNT_PATH;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

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
    return this.client !== null;
  }

  getStatus(): TtsStatus {
    if (this.client) {
      return {
        enabled: true,
        credentialsPath: this.resolvedCredentialsPath ?? undefined,
      };
    }
    return { enabled: false, error: this.initError ?? "Not initialized" };
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
    const cleaned = stripForTts(text).slice(0, MAX_TEXT_LENGTH);
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
