import { api } from "../api/client";

/**
 * Shared read-aloud (TTS) controller. Exactly ONE audio plays at a time across
 * the whole app, so the per-message button and the auto-read feature never
 * overlap. Playback streams in chunks (fast-start), mirroring the server's
 * /api/tts/plan + /api/tts/synthesize pipeline.
 */

export type ReadAloudState = "idle" | "loading" | "playing";

let audioEl: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let sessionId = 0;
let token: string | null = null;
let state: ReadAloudState = "idle";

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeReadAloud(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current playback state. */
export function getReadAloudState(): ReadAloudState {
  return state;
}

/** Identifier of whoever started the current playback (or null when idle). */
export function getReadAloudToken(): string | null {
  return token;
}

export function stopReadAloud(): void {
  sessionId++;
  if (audioEl) {
    audioEl.pause();
    // Detach handlers before clearing src: assigning src = "" fires an
    // `error` event that would otherwise reject the in-flight playUrl and log
    // a spurious "Read aloud failed". Session tracking (alive()) is the real
    // stop signal, so dropping these handlers is safe.
    audioEl.onended = null;
    audioEl.onerror = null;
    audioEl.src = "";
    audioEl = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  token = null;
  if (state !== "idle") {
    state = "idle";
    emit();
  }
}

function base64ToObjectUrl(audioBase64: string): string {
  const bytes = Uint8Array.from(atob(audioBase64), (ch) => ch.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

/**
 * Read the given text aloud. `id` identifies the caller so the UI can show
 * which message is currently playing. Creating the Audio element synchronously
 * inside the user gesture keeps mobile autoplay rules happy.
 */
export async function playReadAloud(text: string, id: string): Promise<void> {
  stopReadAloud();
  const mySession = ++sessionId;
  const audio = new Audio();
  audioEl = audio;
  token = id;
  state = "loading";
  emit();

  const alive = () => sessionId === mySession && audioEl === audio;

  const playUrl = (url: string): Promise<void> =>
    new Promise((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("audio playback failed"));
      const prev = objectUrl;
      objectUrl = url;
      audio.src = url;
      if (prev && prev !== url) URL.revokeObjectURL(prev);
      audio.play().catch(reject);
    });

  try {
    const { chunks } = await api.ttsPlan(text);
    if (!alive() || chunks.length === 0) {
      if (alive()) stopReadAloud();
      return;
    }
    // Fetch chunk i; prefetch i+1 in parallel for seamless playback.
    let pending: Promise<{ audioBase64: string }> | null = api.ttsSynthesize(
      chunks[0] as string,
      true,
    );
    for (let i = 0; i < chunks.length; i++) {
      const current = pending;
      const next = chunks[i + 1];
      pending = next ? api.ttsSynthesize(next, true) : null;
      if (!current) {
        pending?.catch(() => {});
        break;
      }
      const { audioBase64 } = await current;
      if (!alive()) {
        pending?.catch(() => {});
        return;
      }
      if (i === 0) {
        state = "playing";
        emit();
      }
      await playUrl(base64ToObjectUrl(audioBase64));
      if (!alive()) {
        pending?.catch(() => {});
        return;
      }
    }
    if (alive()) stopReadAloud();
  } catch (err) {
    console.error("Read aloud failed:", err);
    if (alive()) stopReadAloud();
  }
}
