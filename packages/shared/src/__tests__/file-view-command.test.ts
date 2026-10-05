import { describe, expect, it } from "vitest";
import {
  formatFileViewLineSuffix,
  formatFileViewPart,
  parseFileViewArgument,
} from "../file-view-command.js";

describe("parseFileViewArgument", () => {
  it("splits whitespace parts and keeps quoted parts whole", () => {
    expect(parseFileViewArgument('  src  "my file.ts" ')).toEqual({
      parts: ["src", "my file.ts"],
    });
    expect(parseFileViewArgument(String.raw`"a \"b\" \\c"`)).toEqual({
      parts: [String.raw`a "b" \c`],
    });
    expect(parseFileViewArgument("   ")).toEqual({ parts: [] });
  });

  it("takes a cited line target from the last part only", () => {
    expect(parseFileViewArgument("src/app.ts:42")).toEqual({
      parts: ["src/app.ts"],
      line: { lineNumber: 42 },
    });
    expect(parseFileViewArgument("app.ts:42:7")).toEqual({
      parts: ["app.ts"],
      line: { lineNumber: 42 },
    });
    expect(parseFileViewArgument("server app.ts:10-20")).toEqual({
      parts: ["server", "app.ts"],
      line: { lineNumber: 10, lineEnd: 20 },
    });
    expect(parseFileViewArgument("app.ts#L5-L9")).toEqual({
      parts: ["app.ts"],
      line: { lineNumber: 5, lineEnd: 9 },
    });
    expect(parseFileViewArgument("a:1 b")).toEqual({ parts: ["a:1", "b"] });
    expect(parseFileViewArgument("C:/x/y.ts")).toEqual({
      parts: ["C:/x/y.ts"],
    });
    expect(parseFileViewArgument("app.ts:0")).toEqual({ parts: ["app.ts:0"] });
  });

  it("round-trips a path and line target it formats", () => {
    const path = 'dir/with space "q".md';
    const line = { lineNumber: 3, lineEnd: 8 };
    expect(
      parseFileViewArgument(
        `${formatFileViewPart(path)}${formatFileViewLineSuffix(line)}`,
      ),
    ).toEqual({ parts: [path], line });
  });
});
