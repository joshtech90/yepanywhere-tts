import { describe, expect, it } from "vitest";
import { presentToolOutput } from "../toolOutputPresentation";

describe("tool output presentation", () => {
  it("distinguishes a banner and JSON records from ordinary command output", () => {
    const parts = presentToolOutput(
      'master\n# acli: 1 complete\n{"ok":true,"count":0}\n{"items":[]}\n',
    );
    expect(parts.map((part) => part.kind)).toEqual([
      "text",
      "metadata",
      "json",
      "json",
    ]);
    expect(parts[2]?.text).toBe('{\n  "ok": true,\n  "count": 0\n}\n');
    expect(presentToolOutput("0\t0\n")).toEqual([
      { kind: "text", source: "0\t0\n", text: "0\t0\n" },
    ]);
  });
  it("preserves numeric spelling, duplicate keys, and encoded source strings", () => {
    const source =
      '{"n":9007199254740993,"n":1e+20,"stdout":"{\\"ok\\":true}\\n"}\n';
    const part = presentToolOutput(source)[0]!;
    expect(part.text).toContain("9007199254740993");
    expect(part.text).toContain("1e+20");
    expect(part.text).toContain('"stdout": "{\\"ok\\":true}\\n"');
    expect(part.source).toBe(source);
  });
  it("retains malformed, truncated, unknown-version, and fenced data verbatim", () => {
    for (const text of [
      '{"ok":',
      "# acli: 2 complete\n",
      '```text\n# acli: 1 complete\n{"ok":true}\n```\n',
    ]) {
      const parts = presentToolOutput(text);
      expect(parts.every((part) => part.kind === "text")).toBe(true);
      expect(parts.map((part) => part.text).join("")).toBe(text);
    }
  });
});
