import { z } from "zod";
import { defineTool } from "../defineTool";
import type { DisplayFixtureManifest } from "./displayFixtures";
const contract = {
  input: z.object({ path: z.string() }),
  result: z.object({ lines: z.array(z.string()) }),
  variants: ["file"] as const,
  standaloneResult: true,
};
// This source is included in the ordinary client tsc gate. @ts-expect-error
// itself fails when a regression accidentally permits the forbidden access.
function typeChecks() {
  defineTool(contract, {
    tool: "typed",
    renderToolUse(input, context) {
      input.path.toUpperCase();
      // @ts-expect-error Inspection records are not rich callback context.
      void context.toolUseResult;
      // @ts-expect-error A checked callback cannot retrieve raw nested inputs.
      void context.getToolUse;
      // @ts-expect-error Only schema output reaches the callback.
      input.missing.toUpperCase();
      return null;
    },
    renderToolResult(result) {
      result.lines.map((line) => line.toUpperCase());
      // @ts-expect-error Nested callback values retain their inferred type.
      result.lines.map((line) => line.nonexistent());
      return null;
    },
  });
  defineTool(contract, {
    tool: "narrow-callback",
    // @ts-expect-error Explicit annotations cannot demand unchecked fields.
    renderToolUse(input: { path: string; missing: string }) {
      return input.missing.toUpperCase();
    },
    renderToolResult: () => null,
  });
  defineTool(contract, {
    tool: "narrow-result",
    renderToolUse: () => null,
    // @ts-expect-error Result callbacks cannot narrow nested schema output.
    renderToolResult(result: { lines: string[]; missing: string }) {
      return result.missing.toUpperCase();
    },
  });
  defineTool(
    // @ts-expect-error A contract is mandatory, not an optional separate map.
    { variants: ["file"], standaloneResult: false },
    {
      tool: "untyped",
      renderToolUse: () => null,
      renderToolResult: () => null,
    },
  );
  // @ts-expect-error An untested registry is not a complete fixture manifest.
  const missingFixture: DisplayFixtureManifest = {};
  const invalidFixture: DisplayFixtureManifest["Write"]["file"] = {
    // @ts-expect-error Fixture input must satisfy the declared input contract.
    input: { content: "missing path" },
    result: {
      file: {
        filePath: "a",
        content: "b",
        numLines: 1,
        startLine: 1,
        totalLines: 1,
      },
    },
    text: "b",
    provenance: "synthetic invalid probe",
  };
  void missingFixture;
  void invalidFixture;
}
void typeChecks;
