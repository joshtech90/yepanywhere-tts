import { useCallback, useEffect, useRef, useState } from "react";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import { transcribeSpeechAudio } from "../lib/speechProviders/YaServerProvider";

export const COCKPIT_DICTATION_BACKEND = "ya-groq";
/** Long enough for a spoken brief, well below Groq's 25 MB upload limit. */
const MAX_RECORDING_MS = 10 * 60 * 1000;

export type CockpitDictationState = "idle" | "recording" | "transcribing";

/** WebKit (Mac app, iOS) records mp4; Chromium and Firefox record webm. */
function recorderMimeType(): string | undefined {
  for (const mime of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

function canRecord(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * Press-to-toggle dictation through the server's Groq backend. The button is
 * offered only when the server advertises `ya-groq`, so hosts without a key
 * pool show no dead control. Typing stays untouched while recording or
 * transcribing: the text lands at the caret only once Groq answers.
 */
export function useCockpitDictation(onText: (text: string) => void) {
  const { t } = useI18n();
  const { version } = useVersion();
  const [state, setState] = useState<CockpitDictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const available =
    canRecord() &&
    (version?.voiceBackends ?? []).includes(COCKPIT_DICTATION_BACKEND);

  const releaseMic = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseMic();
    };
  }, [releaseMic]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (aliveRef.current) setError(t("cockpitDictationMicDenied"));
      return;
    }
    if (!aliveRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    streamRef.current = stream;
    const mimeType = recorderMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMic();
      if (recorderRef.current !== recorder) return;
      recorderRef.current = null;
      const audio = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      if (audio.size === 0) {
        setState("idle");
        return;
      }
      setState("transcribing");
      transcribeSpeechAudio(audio, COCKPIT_DICTATION_BACKEND)
        .then(({ text }) => {
          if (!aliveRef.current) return;
          const spoken = text.trim();
          if (spoken) onTextRef.current(spoken);
        })
        .catch((cause: unknown) => {
          if (!aliveRef.current) return;
          const message =
            cause instanceof Error ? cause.message : String(cause);
          setError(t("cockpitDictationFailed", { message }));
        })
        .finally(() => {
          if (aliveRef.current) setState("idle");
        });
    };
    recorderRef.current = recorder;
    recorder.start();
    timerRef.current = setTimeout(() => recorder.stop(), MAX_RECORDING_MS);
    setState("recording");
  }, [releaseMic, t]);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [start, state, stop]);

  return { available, error, state, toggle };
}

/**
 * Insert dictated text at the textarea's caret (or the end when it has no
 * focus), padding with single spaces so words never fuse. Returns the new
 * value and the caret position after the inserted text.
 */
export function insertDictation(
  value: string,
  text: string,
  selection: { start: number; end: number } | null,
): { value: string; caret: number } {
  const start = selection?.start ?? value.length;
  const end = selection?.end ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const inserted = `${lead}${text}${trail}`;
  return {
    value: `${before}${inserted}${after}`,
    caret: before.length + lead.length + text.length,
  };
}
