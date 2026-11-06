import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { TranscribeOptions } from "./SpeechBackend.js";

const TIMEOUT_MS = 60_000;
/** Above this peak a recording may hold speech; Groq invents text on silence. */
const SILENCE_DB = -50;
const FFMPEG_PATHS = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];

export type DictationFallback = (
  audio: Buffer,
  options: TranscribeOptions,
) => Promise<string>;

/**
 * The grok-tts service's file transcription, used when Groq fails. It rests on
 * a single web login that also carries read-aloud, so it serves single
 * dictations only. A 422 means Grok heard no speech, which is an empty result.
 */
export function grokWebFallback(
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): DictationFallback {
  return async (audio, options) => {
    const base = (env.TTS_GROK_URL || "http://127.0.0.1:8812").replace(
      /\/+$/,
      "",
    );
    const tokenFile =
      env.TTS_GROK_TOKEN_FILE ||
      join(homedir(), ".config", "grok-tts", "token");
    const token = await readFile(tokenFile, "utf-8").then(
      (value) => value.trim(),
      () => "",
    );
    const mimeType =
      (options.mimeType ?? "audio/webm").split(";")[0]?.trim() ?? "audio/webm";
    const bytes = audio.buffer.slice(
      audio.byteOffset,
      audio.byteOffset + audio.byteLength,
    ) as ArrayBuffer;
    const res = await fetchImpl(`${base}/stt`, {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: bytes,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 422) return "";
    if (!res.ok)
      throw new Error(`Grok transcription failed (HTTP ${res.status})`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  };
}

/** True only when ffmpeg measures a silent recording; any failure means "not silent". */
export async function isSilentRecording(audio: Buffer): Promise<boolean> {
  const ffmpeg = FFMPEG_PATHS.find((path) => existsSync(path));
  if (!ffmpeg) return false;
  const folder = mkdtempSync(join(tmpdir(), "yep-stt-"));
  try {
    const file = join(folder, "audio");
    writeFileSync(file, audio, { mode: 0o600 });
    const stderr = await new Promise<string>((resolve) => {
      execFile(
        ffmpeg,
        [
          "-nostdin",
          "-hide_banner",
          "-protocol_whitelist",
          "file",
          "-i",
          file,
          "-map",
          "0:a:0",
          "-af",
          "volumedetect",
          "-f",
          "null",
          "-",
        ],
        { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 },
        (error, _stdout, output) => resolve(error ? "" : output),
      );
    });
    const match = stderr.match(/max_volume:\s*(-?[\d.]+|-inf) dB/);
    if (!match?.[1]) return false;
    return match[1] === "-inf" || Number(match[1]) <= SILENCE_DB;
  } catch {
    return false;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
