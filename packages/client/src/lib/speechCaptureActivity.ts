export type SpeechCapturePhase = "starting" | "capturing";

const activeOwners = new Map<object, SpeechCapturePhase>();
const audioFocusExemptOwners = new Set<object>();
const originalMutedStates = new Map<HTMLMediaElement, boolean>();

let activePhase: SpeechCapturePhase | null = null;
let mediaObserver: MutationObserver | null = null;

function muteMediaElement(element: HTMLMediaElement): void {
  if (!originalMutedStates.has(element)) {
    originalMutedStates.set(element, element.muted);
  }
  element.muted = true;
}

function muteMediaIn(root: ParentNode): void {
  if (root instanceof HTMLMediaElement) muteMediaElement(root);
  for (const element of root.querySelectorAll?.("audio, video") ?? []) {
    muteMediaElement(element as HTMLMediaElement);
  }
}

function keepMediaMuted(event: Event): void {
  if (event.target instanceof HTMLMediaElement) {
    muteMediaElement(event.target);
  }
}

function startMediaMuting(): void {
  if (typeof document === "undefined") return;
  muteMediaIn(document);
  document.addEventListener("play", keepMediaMuted, true);
  document.addEventListener("volumechange", keepMediaMuted, true);
  if (typeof MutationObserver === "undefined") return;
  mediaObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) muteMediaIn(node);
      }
    }
  });
  mediaObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function stopMediaMuting(): void {
  if (typeof document !== "undefined") {
    document.removeEventListener("play", keepMediaMuted, true);
    document.removeEventListener("volumechange", keepMediaMuted, true);
  }
  mediaObserver?.disconnect();
  mediaObserver = null;
  for (const [element, wasMuted] of originalMutedStates) {
    element.muted = wasMuted;
  }
  originalMutedStates.clear();
}

// Chrome on Android requests AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK for an
// unmuted playing element whose known duration is at most 5 seconds, and
// holds it while playback continues; Android keeps other apps ducked for that
// span. Opening the microphone alone ducks them only momentarily. The element
// stays detached so the document-level mute above never reaches it.
const FOCUS_CLIP_SAMPLE_RATE = 8000;
let focusHoldElement: HTMLAudioElement | null = null;
let focusClipUrl: string | null = null;

function silentWavUrl(): string {
  if (focusClipUrl) return focusClipUrl;
  const sampleCount = FOCUS_CLIP_SAMPLE_RATE;
  const view = new DataView(new ArrayBuffer(44 + sampleCount * 2));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, FOCUS_CLIP_SAMPLE_RATE, true);
  view.setUint32(28, FOCUS_CLIP_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  focusClipUrl = URL.createObjectURL(
    new Blob([view.buffer], { type: "audio/wav" }),
  );
  return focusClipUrl;
}

function holdsAndroidAudioFocus(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Android/.test(navigator.userAgent) &&
    typeof Audio !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

function startAudioFocusHold(): void {
  if (focusHoldElement || !holdsAndroidAudioFocus()) return;
  const element = new Audio(silentWavUrl());
  element.loop = true;
  focusHoldElement = element;
  element.play().catch((err: unknown) => {
    console.warn("[speech] audio focus hold could not start", err);
  });
}

function stopAudioFocusHold(): void {
  if (!focusHoldElement) return;
  focusHoldElement.pause();
  focusHoldElement.removeAttribute("src");
  focusHoldElement.load();
  focusHoldElement = null;
}

function aggregatePhase(): SpeechCapturePhase | null {
  let starting = false;
  for (const phase of activeOwners.values()) {
    if (phase === "capturing") return "capturing";
    starting = true;
  }
  return starting ? "starting" : null;
}

function publishAggregatePhase(): void {
  const nextPhase = aggregatePhase();
  if (nextPhase === activePhase) return;
  const wasActive = activePhase !== null;
  activePhase = nextPhase;

  if (typeof document !== "undefined") {
    if (nextPhase) {
      document.documentElement.dataset.speechCapture = nextPhase;
    } else {
      delete document.documentElement.dataset.speechCapture;
    }
  }

  if (!wasActive && nextPhase) startMediaMuting();
  if (wasActive && !nextPhase) stopMediaMuting();
}

function publishAudioFocusHold(): void {
  for (const owner of activeOwners.keys()) {
    if (!audioFocusExemptOwners.has(owner)) {
      startAudioFocusHold();
      return;
    }
  }
  stopAudioFocusHold();
}

/**
 * Coordinate capture effects across every mounted composer. A stable owner
 * token prevents one idle composer from undoing another composer's capture.
 * `holdAudioFocus: false` mutes YA media without ducking other apps; a
 * retained idle microphone uses it so other apps stay ducked only while a
 * dictation or recording is in progress.
 */
export function setSpeechCaptureActivity(
  owner: object,
  phase: SpeechCapturePhase | null,
  { holdAudioFocus = true }: { holdAudioFocus?: boolean } = {},
): void {
  if (phase) activeOwners.set(owner, phase);
  else activeOwners.delete(owner);
  if (phase && !holdAudioFocus) audioFocusExemptOwners.add(owner);
  else audioFocusExemptOwners.delete(owner);
  publishAggregatePhase();
  publishAudioFocusHold();
}

/** Test-only reset for module state shared across jsdom test cases. */
export function resetSpeechCaptureActivityForTests(): void {
  activeOwners.clear();
  audioFocusExemptOwners.clear();
  activePhase = null;
  stopAudioFocusHold();
  stopMediaMuting();
  if (typeof document !== "undefined") {
    delete document.documentElement.dataset.speechCapture;
  }
}
