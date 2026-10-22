import { api } from "../api/client";

/**
 * Shared read-aloud (TTS) controller. Exactly ONE audio plays at a time across
 * the whole app, so the per-message button and the auto-read feature never
 * overlap. Playback streams in chunks (fast-start), mirroring the server's
 * /api/tts/plan + /api/tts/synthesize pipeline.
 */

export type ReadAloudState = "idle" | "loading" | "playing" | "paused";

let audioEl: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let cancelPlaybackWait: (() => void) | null = null;
let cancelNetworkWait: (() => void) | null = null;
let sessionId = 0;
let playAttempt = 0;
let token: string | null = null;
let failedToken: string | null = null;
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

/** Identifier of the most recent caller whose playback failed. */
export function getReadAloudFailedToken(): string | null {
  return failedToken;
}

function resetReadAloud(nextFailedToken: string | null): void {
  const shouldEmit =
    state !== "idle" || token !== null || failedToken !== nextFailedToken;
  sessionId++;
  cancelNetworkWait?.();
  cancelNetworkWait = null;
  cancelPlaybackWait?.();
  cancelPlaybackWait = null;
  if (audioEl) {
    audioEl.pause();
    // Detach handlers before clearing src: assigning src = "" fires an
    // `error` event that would otherwise reject the in-flight playUrl and log
    // a spurious "Read aloud failed". Session tracking (alive()) is the real
    // stop signal, so dropping these handlers is safe.
    audioEl.onended = null;
    audioEl.onerror = null;
    audioEl.onpause = null;
    audioEl.onplay = null;
    audioEl.src = "";
    audioEl = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  token = null;
  failedToken = nextFailedToken;
  state = "idle";
  if (shouldEmit) emit();
}

export function stopReadAloud(): void {
  resetReadAloud(null);
}

/**
 * Pause the running playback where it is. Chunks keep loading in the
 * background; `resumeReadAloud` continues from the same position.
 */
export function pauseReadAloud(): void {
  if (state !== "playing" && state !== "loading") return;
  playAttempt++;
  audioEl?.pause();
  state = "paused";
  emit();
}

/** Continue a paused playback. Resuming inside the tap keeps autoplay happy. */
export function resumeReadAloud(): void {
  if (state !== "paused" || !audioEl) return;
  // Between chunks (nothing loaded yet, or the last chunk ended) the loop
  // starts the next one itself; replaying an ended chunk would repeat it.
  const waitingForChunk = !audioEl.src || audioEl.ended;
  state = waitingForChunk ? "loading" : "playing";
  emit();
  if (!waitingForChunk) {
    const audio = audioEl;
    const mySession = sessionId;
    const attempt = ++playAttempt;
    audio.play().catch(() => {
      // Only this playback, and only if nothing paused or replaced it since.
      if (
        sessionId === mySession &&
        audioEl === audio &&
        playAttempt === attempt &&
        state === "playing"
      ) {
        pauseReadAloud();
      }
    });
  }
}

function base64ToObjectUrl(audioBase64: string, mimeType?: string): string {
  const bytes = Uint8Array.from(atob(audioBase64), (ch) => ch.charCodeAt(0));
  // Server sends Ogg/Opus (Gemini read-aloud) or MP3 (Google Cloud fallback).
  return URL.createObjectURL(
    new Blob([bytes], { type: mimeType || "audio/mpeg" }),
  );
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
  // A call, the lock screen or unplugged headphones pause and resume the
  // element directly; the controls follow so one tap acts on the real state.
  // The pause just before "ended" and late events of a pause the user has
  // already undone do not count.
  audio.onpause = () => {
    if (!alive() || !audio.paused || audio.ended || state !== "playing") {
      return;
    }
    playAttempt++;
    state = "paused";
    emit();
  };
  audio.onplay = () => {
    if (!alive() || audio.paused || state !== "paused") return;
    state = "playing";
    emit();
  };
  const cancelled = Symbol("cancelled");
  const cancellation = new Promise<typeof cancelled>((resolve) => {
    cancelNetworkWait = () => resolve(cancelled);
  });

  const playUrl = (url: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const finish = () => {
        if (cancelPlaybackWait === finish) cancelPlaybackWait = null;
        resolve();
      };
      const fail = () => {
        if (cancelPlaybackWait === finish) cancelPlaybackWait = null;
        reject(new Error("audio playback failed"));
      };
      cancelPlaybackWait = finish;
      audio.onended = finish;
      audio.onerror = fail;
      const prev = objectUrl;
      objectUrl = url;
      audio.src = url;
      if (prev && prev !== url) URL.revokeObjectURL(prev);
      // A pause during loading holds the next chunk until resumed.
      if (state !== "paused") {
        const attempt = ++playAttempt;
        audio.play().catch(() => {
          // A pause invalidates this attempt even if a newer resume already
          // succeeded before the browser delivers the aborted play rejection.
          if (!alive() || playAttempt !== attempt) return;
          fail();
        });
      }
    });

  let pending: Promise<{ audioBase64: string; mimeType?: string }> | null =
    null;
  try {
    const plan = await Promise.race([api.ttsPlan(text), cancellation]);
    if (plan === cancelled) return;
    const { chunks } = plan;
    if (!alive() || chunks.length === 0) {
      if (alive()) stopReadAloud();
      return;
    }
    // Fetch chunk i; prefetch i+1 in parallel for seamless playback.
    pending = api.ttsSynthesize(chunks[0] as string, true);
    for (let i = 0; i < chunks.length; i++) {
      const current = pending;
      const next = chunks[i + 1];
      pending = next ? api.ttsSynthesize(next, true) : null;
      // Prefetch can fail while the current audio is still playing. Observe
      // rejection immediately; awaiting this same promise next still reports
      // the failure through the caller's normal retry state.
      pending?.catch(() => {});
      if (!current) {
        pending?.catch(() => {});
        break;
      }
      const result = await Promise.race([current, cancellation]);
      if (result === cancelled) return;
      const { audioBase64, mimeType } = result;
      if (!alive()) {
        pending?.catch(() => {});
        return;
      }
      if (state === "loading") {
        state = "playing";
        emit();
      }
      await playUrl(base64ToObjectUrl(audioBase64, mimeType));
      if (!alive()) {
        pending?.catch(() => {});
        return;
      }
    }
    if (alive()) stopReadAloud();
  } catch (err) {
    pending?.catch(() => {});
    if (alive()) {
      console.error("Read aloud failed:", err);
      resetReadAloud(id);
    }
  }
}
