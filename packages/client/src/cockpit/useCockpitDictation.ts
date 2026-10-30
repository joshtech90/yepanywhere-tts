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
  // One recording at a time: the lock is taken synchronously on click, before
  // the permission prompt, and released only when the attempt ends, so a
  // double click cannot open a second microphone stream.
  const busyRef = useRef(false);
  const recordingRef = useRef<{
    recorder: MediaRecorder;
    release: () => void;
  } | null>(null);
  const aliveRef = useRef(true);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const available =
    canRecord() &&
    (version?.voiceBackends ?? []).includes(COCKPIT_DICTATION_BACKEND);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const recording = recordingRef.current;
      recordingRef.current = null;
      recording?.release();
    };
  }, []);

  const finish = useCallback((message?: string) => {
    busyRef.current = false;
    if (!aliveRef.current) return;
    if (message) setError(message);
    setState("idle");
  }, []);

  const stop = useCallback(() => {
    const recorder = recordingRef.current?.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      finish(t("cockpitDictationMicDenied"));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const releaseStream = () => {
      clearTimeout(timer);
      for (const track of stream.getTracks()) track.stop();
    };
    if (!aliveRef.current) {
      releaseStream();
      finish();
      return;
    }

    let recorder: MediaRecorder;
    const chunks: Blob[] = [];
    try {
      const mimeType = recorderMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
    } catch (cause) {
      releaseStream();
      finish(
        t("cockpitDictationFailed", {
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
      return;
    }

    // Unmount detaches the handlers before stopping, so a late stop event
    // cannot upload audio for a composer that no longer exists.
    const release = () => {
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
      releaseStream();
    };
    recordingRef.current = { recorder, release };
    recorder.onerror = () => {
      if (recordingRef.current?.recorder === recorder) {
        recordingRef.current = null;
      }
      release();
      finish(t("cockpitDictationFailed", { message: "recorder error" }));
    };
    recorder.onstop = () => {
      if (recordingRef.current?.recorder === recorder) {
        recordingRef.current = null;
      }
      releaseStream();
      const audio = new Blob(chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      if (audio.size === 0) {
        finish();
        return;
      }
      if (aliveRef.current) setState("transcribing");
      transcribeSpeechAudio(audio, COCKPIT_DICTATION_BACKEND)
        .then(({ text }) => {
          const spoken = text.trim();
          if (spoken && aliveRef.current) onTextRef.current(spoken);
          finish();
        })
        .catch((cause: unknown) => {
          const message =
            cause instanceof Error ? cause.message : String(cause);
          finish(t("cockpitDictationFailed", { message }));
        });
    };
    timer = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, MAX_RECORDING_MS);
    setState("recording");
  }, [finish, t]);

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
