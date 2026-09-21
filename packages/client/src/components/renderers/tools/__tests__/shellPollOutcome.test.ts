import { describe, expect, it } from "vitest";
import { shellPollOutcome } from "../shellPollOutcome";

const WAIT_TIMEOUT =
  "timeout waiting for master-release-hostpaths-20260915 to reach not-running; current status=running";

describe("shellPollOutcome", () => {
  it("recognizes a wait timeout reported on stderr alone", () => {
    // agentctl writes the timeout to stderr, so a normalized command result
    // carries it there with an empty stdout.
    expect(
      shellPollOutcome({ stdout: "", stderr: WAIT_TIMEOUT, exitCode: 1 }, true),
    ).toEqual({
      kind: "waiting",
      target: "master-release-hostpaths-20260915",
      output: WAIT_TIMEOUT,
      exitCode: 1,
    });
  });

  it("recognizes a wait timeout in a code-mode execution envelope", () => {
    const result = JSON.stringify([
      {
        type: "input_text",
        text: "Script completed\nWall time 60.0 seconds\nOutput:\n",
      },
      {
        type: "input_text",
        text: JSON.stringify({
          chunk_id: "abc",
          wall_time_seconds: 60,
          exit_code: 1,
          output: WAIT_TIMEOUT,
        }),
      },
    ]);
    expect(shellPollOutcome(result, true)).toMatchObject({
      kind: "waiting",
      target: "master-release-hostpaths-20260915",
    });
  });

  it("reads the exit code from the result envelope when the structured result has none", () => {
    const envelope = `Chunk ID: abc\nProcess exited with code 1\nOutput:\n${WAIT_TIMEOUT}`;
    expect(shellPollOutcome({ stdout: WAIT_TIMEOUT }, true)).toMatchObject({
      kind: "compact",
      exitCode: undefined,
    });
    expect(
      shellPollOutcome({ stdout: WAIT_TIMEOUT }, true, envelope),
    ).toMatchObject({ kind: "waiting", exitCode: 1 });
  });

  it("leaves an ordinary single-line failure compact", () => {
    expect(
      shellPollOutcome({ stdout: "permission denied", exitCode: 1 }, true),
    ).toEqual({ kind: "compact", output: "permission denied", exitCode: 1 });
  });

  it("does not read a wait timeout out of a longer report", () => {
    expect(
      shellPollOutcome(
        { stdout: `checking status\n${WAIT_TIMEOUT}`, exitCode: 1 },
        true,
      ),
    ).toBeNull();
  });

  it("declines empty, overlong, and multi-block output", () => {
    expect(shellPollOutcome({ stdout: "   " }, false)).toBeNull();
    expect(shellPollOutcome({ stdout: "x".repeat(501) }, false)).toBeNull();
    expect(
      shellPollOutcome(
        JSON.stringify([
          { type: "input_text", text: "first" },
          { type: "input_text", text: "second" },
        ]),
        false,
      ),
    ).toBeNull();
  });
});
