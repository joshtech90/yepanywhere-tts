import { describe, expect, it } from "vitest";
import {
  decodeAcliRecord,
  getAcliContext,
  AcliRecordFramer,
  declaresAcliCommentary,
  acliCommentaryFormat,
  decodeAcliCommentaryLine,
} from "./acli-commentary.js";

describe("acli commentary", () => {
  it("requires an explicit supported declaration", () => {
    for (const line of [
      "# acli: 1 complete +commentary",
      "acli-capabilities: commentary/1",
      "# acli-capabilities: commentary/1 other/2",
      "# acli-capabilities: commentary-lines/1",
      "# acli: 1 +commentary-lines",
    ]) {
      expect(declaresAcliCommentary(line)).toBe(true);
    }
    for (const line of [
      "python report.py",
      "acli: 1 complete",
      "acli: 2 +commentary",
      "acli-capabilities: commentary/2",
      "acli-capabilities: commentary-lines/2",
      '{"_acli":{}}',
    ]) {
      expect(declaresAcliCommentary(line)).toBe(false);
    }
  });

  it("decodes exact line markers without JSON escaping or hash-comment guessing", () => {
    expect(
      acliCommentaryFormat("# acli-capabilities: commentary-lines/1"),
    ).toBe("lines");
    const text = '  [report](./report.html) \\(x\\) "quoted" — ✓  ';
    for (const ending of ["\n", "\r\n", ""]) {
      const record = decodeAcliCommentaryLine(
        `# _acli.commentary: ${text}${ending}`,
      );
      expect(record.commentary[0]?.text).toBe(text);
      expect(record.metadataOnly).toBe(true);
      expect(record.data).toBe("");
    }
    for (const source of [
      "# ordinary comment\n",
      " # _acli.commentary: Indented\n",
      "# _acli commentary: Wrong separator\n",
      "# _acli.commentary: \n",
      "# _acli.commentary:Missing space\n",
      '{"_acli":{"commentary":[{"text":"Literal JSON"}]}}\n',
      `# _acli.commentary: ${"x".repeat(1024 * 1024)}\n`,
    ]) {
      expect(decodeAcliCommentaryLine(source)).toMatchObject({
        data: source,
        commentary: [],
      });
    }
  });

  it("frames text lines even when ordinary output contains unmatched JSON brackets", () => {
    const framer = new AcliRecordFramer("lines");
    expect(framer.append("{unfinished\n# _acli.com")).toEqual([
      "{unfinished\n",
    ]);
    expect(framer.append("mentary: Ready\r")).toEqual([]);
    expect(framer.append("\n")).toEqual(["# _acli.commentary: Ready\r\n"]);
  });

  it("leaves oversized records raw", () => {
    const source = JSON.stringify({
      text: "x".repeat(1024 * 1024),
      _acli: { commentary: [{ text: "Large" }] },
    });
    expect(decodeAcliRecord(source)).toMatchObject({
      data: source,
      commentary: [],
    });
  });
  it("retains malformed metadata and JSON-looking strings verbatim", () => {
    for (const source of [
      '{"_acli":{"future":1}}',
      '{"_acli":{"commentary":[]}}',
      '{"_acli":{"commentary":[{"text":" "}]}}',
      '{"_acli":{"commentary":[{"text":"Hi","unknown":true}]}}',
      '{"_acli":{"commentary":[{"text":"Hi"}]},"_acli":{}}',
      '{"nested": {"_acli":',
      JSON.stringify({ text: '{"_acli":{"commentary":[{"text":"Literal"}]}}' }),
    ]) {
      expect(decodeAcliRecord(source).data).toBe(source);
      expect(decodeAcliRecord(source).commentary).toEqual([]);
    }
  });

  it("preserves array positions and skips commentary-only predecessors", () => {
    const note = (text: string) => ({ _acli: { commentary: [{ text }] } });
    const record = decodeAcliRecord(
      JSON.stringify([
        note("No predecessor"),
        0,
        note("Zero"),
        note("Still zero"),
        { n: 1 },
      ]),
    );
    expect(record.data).toBe('[{},0,{},{},{"n":1}]');
    expect(
      record.commentary.map((item) => getAcliContext(record, item)),
    ).toEqual([null, "0", "0"]);
  });

  it("removes a first, middle, or last member without changing other bytes", () => {
    const note = '"_acli": {"commentary":[{"text":"Hi"}]}';
    for (const source of [
      `{${note}, "a":1}`,
      `{"a":1,${note}, "b":2}`,
      `{"a":1, ${note}}`,
    ]) {
      const record = decodeAcliRecord(source);
      expect(JSON.parse(record.data)).toEqual(
        source.includes('"b"') ? { a: 1, b: 2 } : { a: 1 },
      );
      expect(record.commentary).toHaveLength(1);
    }
  });

  it("recognizes escaped reserved keys and preserves decoded Markdown", () => {
    const text = "Line one\n\n[link](./file.md) \\(x\\) — ✓";
    const source = JSON.stringify({
      _acli: { commentary: [{ text }] },
    }).replace("_acli", "\\u005facli");
    expect(decodeAcliRecord(source).commentary[0]?.text).toBe(text);
  });
  it("keeps data spelling and serialized order while resolving focused context", () => {
    const source =
      '{"10":{"n":9007199254740993,"_acli":{"commentary":[{"text":"Ten **first**."}]}},"2":{"_acli":{"commentary":[{"text":"Two second."}]}},"_acli":{"commentary":[{"text":"Root."}]}}';
    const record = decodeAcliRecord(source);
    expect(record.commentary.map((item) => item.text)).toEqual([
      "Ten **first**.",
      "Two second.",
      "Root.",
    ]);
    expect(record.data).toBe('{"10":{"n":9007199254740993},"2":{}}');
    expect(getAcliContext(record, record.commentary[0]!)).toBe(
      '{"n":9007199254740993}',
    );
    expect(record.commentary[1]!.context).toBeNull();
    expect(record.commentary[2]!.context).toBeNull();
  });

  it("frames split keys and pretty documents without publishing partial JSON", () => {
    const framer = new AcliRecordFramer();
    expect(framer.append('{\n  "_ac')).toEqual([]);
    expect(
      framer.append('li": {"commentary": [{"text": "Ready."}]}\n}'),
    ).toEqual([]);
    expect(framer.append("\n")).toEqual([
      '{\n  "_acli": {"commentary": [{"text": "Ready."}]}\n}\n',
    ]);
    expect(framer.finish()).toEqual([]);
  });
});
