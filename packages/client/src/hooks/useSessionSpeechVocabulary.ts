import { useEffect, useMemo, useRef } from "react";
import { SessionSpeechVocabulary } from "../lib/SessionSpeechVocabulary";
import type { Message } from "../types";

export function useSessionSpeechVocabulary(
  sessionKey: string,
  messages: readonly Message[],
  enabled: boolean,
) {
  const source = useRef(messages);
  source.current = messages;
  const vocabulary = useMemo(
    () => ({ sessionKey, value: new SessionSpeechVocabulary() }),
    [sessionKey],
  );
  useEffect(() => {
    if (enabled) vocabulary.value.observe(messages);
  }, [vocabulary, messages, enabled]);
  return useMemo(
    () =>
      enabled
        ? {
            terms: () => vocabulary.value.terms(source.current),
            heard: (text: string) => {
              vocabulary.value.terms(source.current);
              vocabulary.value.heard(text);
            },
          }
        : undefined,
    [enabled, vocabulary],
  );
}
