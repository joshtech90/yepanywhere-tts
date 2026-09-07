import { describe, expect, it } from "vitest";
import { decodeCodeModeOutput } from "../src/index.js";

describe("decodeCodeModeOutput", () => {
  const command = {
    chunk_id: "abc",
    wall_time_seconds: 0.4,
    exit_code: 0,
    output: "[workflow][start] publish\n",
  };
  const blocks = (value: unknown) => [
    { type: "input_text", text: JSON.stringify(value) },
  ];

  it("exposes ordered substantive text from code-mode and settled command envelopes", () => {
    const stdout = "@@workflow-schema/1 example\n[workflow][start] publish\n";
    const result = [
      {
        type: "input_text",
        text: "Script completed\nWall time 0.8 seconds\nOutput:\n",
      },
      {
        type: "input_text",
        text: JSON.stringify({
          i: 0,
          status: "fulfilled",
          value: {
            chunk_id: "abc",
            wall_time_seconds: 0.4,
            exit_code: 0,
            output: stdout,
          },
        }),
      },
      { type: "input_text", text: "[workflow][done] publish\n" },
    ];
    const original = JSON.stringify(result);
    const decoded = decodeCodeModeOutput(original);
    expect(decoded?.parts).toEqual([
      {
        kind: "script-status",
        text: "Script completed\nWall time 0.8 seconds",
      },
      {
        kind: "command-output",
        text: stdout,
        exitCode: 0,
        durationSeconds: 0.4,
      },
      { kind: "text", text: "[workflow][done] publish\n" },
    ]);
    expect(decodeCodeModeOutput(result)).toEqual(decoded);
    expect(JSON.stringify(result)).toBe(original);
  });

  it("treats stdout as a leaf even when it is another complete command envelope", () => {
    const printedJson = JSON.stringify(command);
    expect(
      decodeCodeModeOutput(blocks({ ...command, output: printedJson }))?.parts,
    ).toEqual([
      {
        kind: "command-output",
        text: printedJson,
        exitCode: 0,
        durationSeconds: 0.4,
      },
    ]);
  });

  it("can preserve known direct stdout that is indistinguishable from an envelope", () => {
    expect(
      decodeCodeModeOutput(blocks(command), { commandResults: "preserve" })
        ?.parts,
    ).toEqual([{ kind: "text", text: JSON.stringify(command) }]);
  });

  it.each([
    { output: command.output },
    { chunk_id: "abc", output: command.output },
    { ...command, applicationData: true },
    { ...command, exit_code: "0" },
    { ...command, wall_time_seconds: null },
    { ...command, session_id: {} },
    { ...command, original_token_count: -1 },
    { i: -1, status: "fulfilled", value: command },
    { status: "rejected", reason: command },
    { status: "fulfilled", value: { status: "fulfilled", value: command } },
    [{ status: "fulfilled", value: command }],
    [{ type: "input_text", text: command.output }],
  ])("preserves program JSON and unrecognized result forms: %j", (value) => {
    expect(decodeCodeModeOutput(blocks(value))?.parts).toEqual([
      { kind: "text", text: JSON.stringify(value) },
    ]);
  });

  it("retains nonzero exit codes and detached command session ids", () => {
    expect(
      decodeCodeModeOutput(blocks({ ...command, exit_code: 2 }))?.parts[0],
    ).toMatchObject({ kind: "command-output", exitCode: 2 });
    const { exit_code: _exitCode, ...running } = command;
    expect(
      decodeCodeModeOutput(blocks({ ...running, session_id: 4321 }))?.parts[0],
    ).toEqual({
      kind: "command-output",
      text: command.output,
      sessionId: 4321,
      durationSeconds: 0.4,
    });
  });

  it.each([
    [],
    "[truncated",
    "plain output",
    [
      { type: "input_text", text: "valid" },
      { type: "image", image_url: "example.png" },
    ],
    [{ type: ["input_text"], text: "invalid type" }],
    [{ type: "input_text", text: 7 }],
  ])(
    "does not return partial text for an unrecognized outer envelope: %j",
    (result) => {
      expect(decodeCodeModeOutput(result)).toBeUndefined();
    },
  );

  it("keeps separate text blocks separate, including empty blocks", () => {
    const result = ["input_text", "output_text", "text"].map((type, i) => ({
      type,
      text: i ? "" : "@@workflow-schema/1",
    }));
    expect(decodeCodeModeOutput(result)?.parts).toEqual([
      { kind: "text", text: "@@workflow-schema/1" },
      { kind: "text", text: "" },
      { kind: "text", text: "" },
    ]);
  });
});
