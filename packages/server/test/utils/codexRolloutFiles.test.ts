import { describe, expect, it } from "vitest";
import {
  getCodexRolloutActivityTimeMs,
  getCodexRolloutFileIdentity,
  getCodexRolloutId,
  getCodexRolloutSessionId,
} from "../../src/utils/codexRolloutFiles.js";

const THREAD_ID = "11111111-1111-7111-8111-111111111111";
const ROLLOUT_ID = "22222222-2222-7222-8222-222222222222";

describe("Codex rollout filename identity", () => {
  it("uses one id for an ordinary rollout", () => {
    const fileName = `rollout-2026-09-07T12-34-56-${THREAD_ID}.jsonl`;

    expect(getCodexRolloutFileIdentity(fileName)).toEqual({
      threadId: THREAD_ID,
      rolloutId: THREAD_ID,
      timestamp: "2026-09-07T12-34-56",
    });
    expect(getCodexRolloutSessionId(fileName)).toBe(THREAD_ID);
    expect(getCodexRolloutId(fileName)).toBe(THREAD_ID);
  });

  it("separates a reverted thread id from its physical rollout id", () => {
    const fileName = `C:\\codex\\sessions\\rollout-2026-09-07T12-34-56-${THREAD_ID}_${ROLLOUT_ID}.jsonl.zst`;

    expect(getCodexRolloutFileIdentity(fileName)).toEqual({
      threadId: THREAD_ID,
      rolloutId: ROLLOUT_ID,
      timestamp: "2026-09-07T12-34-56",
    });
    expect(getCodexRolloutSessionId(fileName)).toBe(THREAD_ID);
    expect(getCodexRolloutId(fileName)).toBe(ROLLOUT_ID);
  });

  it("keeps accepting timestamp-free test and legacy filenames", () => {
    expect(getCodexRolloutFileIdentity(`rollout-${THREAD_ID}.jsonl`)).toEqual({
      threadId: THREAD_ID,
      rolloutId: THREAD_ID,
    });
    expect(getCodexRolloutFileIdentity("not-a-rollout.jsonl")).toBeNull();
  });
});

describe("getCodexRolloutActivityTimeMs", () => {
  const stats = { mtimeMs: 100, ctimeMs: 200 };

  it("uses Windows change time for an open plain rollout", () => {
    expect(
      getCodexRolloutActivityTimeMs("rollout-session.jsonl", stats, "win32"),
    ).toBe(200);
    expect(
      getCodexRolloutActivityTimeMs(
        "rollout-session.jsonl",
        { mtimeMs: 300, ctimeMs: 200 },
        "win32",
      ),
    ).toBe(300);
  });

  it("keeps mtime on non-Windows platforms", () => {
    expect(
      getCodexRolloutActivityTimeMs("rollout-session.jsonl", stats, "darwin"),
    ).toBe(100);
    expect(
      getCodexRolloutActivityTimeMs("rollout-session.jsonl", stats, "linux"),
    ).toBe(100);
  });

  it("keeps mtime for immutable compressed rollouts on Windows", () => {
    expect(
      getCodexRolloutActivityTimeMs(
        "rollout-session.jsonl.zst",
        stats,
        "win32",
      ),
    ).toBe(100);
  });

  it("falls back to mtime when change time is unavailable", () => {
    expect(
      getCodexRolloutActivityTimeMs(
        "rollout-session.jsonl",
        { mtimeMs: 100, ctimeMs: Number.NaN },
        "win32",
      ),
    ).toBe(100);
  });
});
