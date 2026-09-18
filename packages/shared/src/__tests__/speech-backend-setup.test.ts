import { describe, expect, it } from "vitest";
import {
  isLocalSpeechBackendId,
  parseSpeechVoiceBackends,
  unionSpeechVoiceBackends,
} from "../speech-backend-setup.js";

describe("speech backend setup ids", () => {
  it("parses and unions local backend ids without dropping settings entries", () => {
    expect(parseSpeechVoiceBackends(undefined)).toEqual([]);
    expect(parseSpeechVoiceBackends(["ya-granite", "ya-granite"])).toEqual([
      "ya-granite",
    ]);
    expect(parseSpeechVoiceBackends(["ya-grok"])).toBeNull();
    expect(parseSpeechVoiceBackends("ya-whisper")).toBeNull();
    expect(isLocalSpeechBackendId("ya-nemo")).toBe(true);
    expect(isLocalSpeechBackendId("ya-dummy")).toBe(false);
    expect(
      unionSpeechVoiceBackends(
        ["ya-whisper", "ya-grok"],
        ["ya-granite", "ya-whisper"],
      ),
    ).toEqual(["ya-whisper", "ya-granite"]);
  });
});
