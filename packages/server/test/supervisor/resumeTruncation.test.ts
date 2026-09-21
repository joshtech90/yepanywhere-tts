import { describe, expect, it } from "vitest";
import {
  RESUME_DROPS_TURN_REFUSAL_PREFIX,
  isResumeDropsTurnRefusal,
  resolveResumeTruncation,
} from "../../src/supervisor/resume-truncation.js";

const pendingRewind = {
  recordId: "rw-1",
  cutMessageId: "a1",
  dropsTurnPromptId: "u2",
};

describe("resolveResumeTruncation", () => {
  it("applies a pending rewind to any Claude resume", () => {
    expect(
      resolveResumeTruncation({
        resumeSessionId: "s1",
        providerName: "claude",
        pendingRewind,
      }),
    ).toEqual({
      resumeSessionAt: "a1",
      resumeDropsTurn: "u2",
      rewindRecordId: "rw-1",
    });
  });

  it("lets the pending rewind win over a caller-supplied truncation", () => {
    expect(
      resolveResumeTruncation({
        resumeSessionId: "s1",
        providerName: "claude-gateway",
        pendingRewind,
        requested: { resumeSessionAt: "api-error-tail" },
      }),
    ).toMatchObject({ resumeSessionAt: "a1", rewindRecordId: "rw-1" });
  });

  it("passes a caller-supplied truncation through when nothing is pending", () => {
    expect(
      resolveResumeTruncation({
        resumeSessionId: "s1",
        providerName: "claude",
        pendingRewind: undefined,
        requested: { resumeSessionAt: "a9", resumeDropsTurn: "u9" },
      }),
    ).toEqual({ resumeSessionAt: "a9", resumeDropsTurn: "u9" });
  });

  it("never truncates a new session or a non-Claude provider", () => {
    expect(
      resolveResumeTruncation({
        resumeSessionId: undefined,
        providerName: "claude",
        pendingRewind,
        requested: { resumeSessionAt: "a1" },
      }),
    ).toEqual({});
    expect(
      resolveResumeTruncation({
        resumeSessionId: "s1",
        providerName: "codex",
        pendingRewind,
      }),
    ).toEqual({});
  });
});

describe("isResumeDropsTurnRefusal", () => {
  it("recognizes the CLI's refusal result by its message prefix", () => {
    expect(
      isResumeDropsTurnRefusal({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: [`${RESUME_DROPS_TURN_REFUSAL_PREFIX} range holds u3`],
      }),
    ).toBe(true);
    expect(
      isResumeDropsTurnRefusal({
        type: "result",
        subtype: "error_during_execution",
        result: `${RESUME_DROPS_TURN_REFUSAL_PREFIX} range holds u3`,
      }),
    ).toBe(true);
  });

  it("ignores ordinary results and other errors", () => {
    expect(
      isResumeDropsTurnRefusal({ type: "result", subtype: "success" }),
    ).toBe(false);
    expect(
      isResumeDropsTurnRefusal({
        type: "result",
        subtype: "error_during_execution",
        errors: ["API error 500"],
      }),
    ).toBe(false);
    expect(
      isResumeDropsTurnRefusal({
        type: "assistant",
        message: { content: RESUME_DROPS_TURN_REFUSAL_PREFIX },
      }),
    ).toBe(false);
  });
});
