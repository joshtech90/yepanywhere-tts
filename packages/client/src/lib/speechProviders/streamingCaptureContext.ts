/**
 * One AudioContext reused across streaming dictations while Keep Mic Warm is
 * on. A per-dictation context made every start pay the capture worklet's
 * module load, which a warm mic otherwise leaves exposed as start latency.
 * Between dictations the context is suspended, so it holds no running audio
 * thread; it is closed when the page is hidden with no capture using it.
 * Without Keep Mic Warm (the mobile norm), each dictation still gets its own
 * context. See topics/streaming-speech-capture.md § Capture modes.
 */

import { prepareMicSampleTap } from "./micSampleTap";

interface SharedContext {
  context: AudioContext;
  AudioContextCtor: typeof AudioContext;
  users: number;
}

let shared: SharedContext | null = null;
let lifecycleInstalled = false;

function createContext(
  AudioContextCtor: typeof AudioContext,
  sampleRate: number,
): AudioContext {
  try {
    return new AudioContextCtor({ latencyHint: "interactive", sampleRate });
  } catch {
    try {
      return new AudioContextCtor({ latencyHint: "interactive" });
    } catch {
      return new AudioContextCtor();
    }
  }
}

function closeIdleContext(): void {
  if (!shared || shared.users > 0) return;
  const { context } = shared;
  shared = null;
  void context.close().catch(() => undefined);
}

function installLifecycle(): void {
  if (lifecycleInstalled || typeof document === "undefined") return;
  lifecycleInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") closeIdleContext();
  });
}

function ensureShared(
  AudioContextCtor: typeof AudioContext,
  sampleRate: number,
): SharedContext {
  if (
    !shared ||
    shared.context.state === "closed" ||
    shared.AudioContextCtor !== AudioContextCtor
  ) {
    // A replaced context stays with its current leases, which close it.
    shared = {
      context: createContext(AudioContextCtor, sampleRate),
      AudioContextCtor,
      users: 0,
    };
    installLifecycle();
  }
  void prepareMicSampleTap(shared.context);
  return shared;
}

export interface StreamingCaptureContextLease {
  context: AudioContext;
  /** Idempotent. Closes a private context; suspends an idle shared one. */
  release(): void;
}

/**
 * The capture context for a starting dictation: the shared one when `reuse`,
 * otherwise a private one. Call synchronously inside the user gesture and
 * resume it there.
 */
export function acquireStreamingCaptureContext(
  AudioContextCtor: typeof AudioContext,
  sampleRate: number,
  { reuse }: { reuse: boolean },
): StreamingCaptureContextLease {
  let released = false;
  if (!reuse) {
    const context = createContext(AudioContextCtor, sampleRate);
    return {
      context,
      release: () => {
        if (released) return;
        released = true;
        void context.close().catch(() => undefined);
      },
    };
  }
  const owner = ensureShared(AudioContextCtor, sampleRate);
  owner.users += 1;
  const { context } = owner;
  return {
    context,
    release: () => {
      if (released) return;
      released = true;
      owner.users -= 1;
      if (owner !== shared) {
        // Replaced while this lease held it.
        if (owner.users === 0) void context.close().catch(() => undefined);
      } else if (owner.users === 0 && context.state === "running") {
        void context.suspend().catch(() => undefined);
      }
    },
  };
}

/**
 * Create the context and load the capture worklet ahead of the first
 * dictation. It stays suspended until a gesture resumes it. Skipped before the
 * page has had user activation, where browsers refuse to start audio and
 * warn about the attempt.
 */
export function prewarmStreamingCaptureContext(
  AudioContextCtor: typeof AudioContext,
  sampleRate: number,
): void {
  if (
    typeof navigator !== "undefined" &&
    navigator.userActivation?.hasBeenActive === false
  ) {
    return;
  }
  ensureShared(AudioContextCtor, sampleRate);
}
