import { describe, expect, it, vi } from "vitest";
import { AcliToolOutput, type AcliOutputProjection } from "../acliToolOutput";

const note = (text: string) =>
  JSON.stringify({ _acli: { commentary: [{ text }] } });
const banner = "# acli-capabilities: commentary/1\n";
const lineBanner = "# acli-capabilities: commentary-lines/1\n";
const line = (text: string) => `# _acli.commentary: ${text}\n`;
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("acli tool output publication", () => {
  it("preserves stdout block contexts across character-sized chunks and replay", async () => {
    const snapshots: AcliOutputProjection[] = [];
    const render = vi.fn(async (texts: string[]) =>
      texts.map((text) => `<p>${text}</p>`),
    );
    const stream = new AcliToolOutput(render, (value) => snapshots.push(value));
    const source =
      lineBanner +
      line("Root") +
      "{first\n# ordinary\n" +
      line("First") +
      line("Same block") +
      "next\n" +
      line("Second");
    for (let end = 1; end <= source.length; end++) {
      stream.appendSnapshot(source.slice(0, end), false);
      await tick();
    }
    stream.appendSnapshot(source, true);
    await tick();
    const output = snapshots.at(-1)!;
    expect(output.stdout).toBe("{first\n# ordinary\nnext\n");
    expect(
      output.commentary.map((item) => item.getContext?.() ?? null),
    ).toEqual([null, "{first\n# ordinary\n", "{first\n# ordinary\n", "next\n"]);
    expect(output.complete).toBe(true);
    stream.appendSnapshot(source, true);
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("keeps stderr commentary unsequenced and does not reinterpret stdout JSON", async () => {
    const snapshots: AcliOutputProjection[] = [];
    const stream = new AcliToolOutput(
      async (texts) => texts,
      (value) => snapshots.push(value),
    );
    const stdout = `${note("Ordinary JSON")}\n${line("Undeclared stdout")}`;
    stream.appendSnapshot(
      stdout,
      true,
      `${lineBanner}diagnostic\n${line("Unsequenced")}`,
    );
    await tick();
    expect(snapshots.at(-1)).toMatchObject({
      stdout,
      stderr: "diagnostic\n",
      complete: true,
    });
    expect(
      snapshots.at(-1)?.commentary.map((item) => [item.text, item.getContext]),
    ).toEqual([["Unsequenced", null]]);
  });

  it("does not assign stdout context when a wrapper lost the channel identity", async () => {
    const snapshots: AcliOutputProjection[] = [];
    new AcliToolOutput(
      async (texts) => texts,
      (value) => snapshots.push(value),
      undefined,
      false,
    ).appendSnapshot(
      `${lineBanner}maybe stdout\n${line("Unknown channel")}`,
      true,
    );
    await tick();
    expect(snapshots.at(-1)?.commentary[0]?.getContext).toBeNull();
  });

  it("keeps late declarations and malformed notes literal", async () => {
    const snapshots: AcliOutputProjection[] = [];
    const render = vi.fn(async (texts: string[]) => texts);
    const source = `data\n${lineBanner}${line("Too late")}`;
    new AcliToolOutput(render, (value) => snapshots.push(value)).appendSnapshot(
      source,
      true,
    );
    await tick();
    expect(snapshots.at(-1)?.stdout).toBe(source);
    expect(render).not.toHaveBeenCalled();
    const malformed = `${lineBanner}# _acli.commentary: \n# ordinary\n${lineBanner}`;
    new AcliToolOutput(render, (value) => snapshots.push(value)).appendSnapshot(
      malformed,
      true,
    );
    await tick();
    expect(snapshots.at(-1)?.stdout).toBe(malformed.slice(lineBanner.length));
    expect(render).not.toHaveBeenCalled();
  });

  it("retains failed stderr notes and rejects replacements of either source", async () => {
    const snapshots: AcliOutputProjection[] = [];
    const stream = new AcliToolOutput(
      async () => {
        throw new Error("Offline");
      },
      (value) => snapshots.push(value),
    );
    const stderr = lineBanner + line("Retained");
    stream.appendSnapshot("data\n", true, stderr);
    await tick();
    expect(snapshots.at(-1)).toMatchObject({
      stdout: "data\n",
      stderr: line("Retained"),
      failed: true,
    });
    expect(stream.appendSnapshot("data\n", true, `${stderr}new`)).toBe(false);
    expect(stream.appendSnapshot("replacement\n", true, stderr)).toBe(false);
  });

  it("publishes a record atomically after Markdown resolves and deduplicates replay", async () => {
    let finish!: (html: string[]) => void;
    const render = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    );
    const publications: AcliOutputProjection[] = [];
    const stream = new AcliToolOutput(render, (value) =>
      publications.push(value),
    );
    const source = `${banner}${JSON.stringify({ value: 1, _acli: { commentary: [{ text: "**Ready**" }] } })}\n`;
    stream.appendSnapshot(source.slice(0, 20), false);
    expect(publications).toEqual([]);
    stream.appendSnapshot(source, false);
    expect(publications).toEqual([]);
    expect(render).toHaveBeenCalledTimes(1);
    finish(["<p><strong>Ready</strong></p>"]);
    await tick();
    expect(publications.at(-1)?.stdout).toBe('{"value":1}\n');
    expect(publications.at(-1)?.commentary[0]?.text).toBe("**Ready**");
    stream.appendSnapshot(source, true);
    expect(publications.at(-1)?.complete).toBe(true);
    stream.appendSnapshot(source, true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(publications.at(-1)?.commentary).toHaveLength(1);
  });

  it("keeps JSONL context within one invocation and skips standalone predecessors", async () => {
    const snapshots: AcliOutputProjection[] = [];
    const render = async (texts: string[]) =>
      texts.map((text) => `<p>${text}</p>`);
    const stream = new AcliToolOutput(render, (value) => snapshots.push(value));
    stream.appendSnapshot(
      `${banner}${note("First")}\n{"value":1}\n${note("Second")}\n${note("Third")}\n`,
      true,
    );
    await tick();
    const output = snapshots.at(-1)!;
    expect(output.stdout).toBe('{"value":1}\n');
    expect(
      output.commentary.map((item) => item.getContext?.() ?? null),
    ).toEqual([null, '{"value":1}\n', '{"value":1}\n']);
    const separate: AcliOutputProjection[] = [];
    new AcliToolOutput(render, (value) => separate.push(value)).appendSnapshot(
      banner + note("Other call"),
      true,
    );
    await tick();
    expect(separate.at(-1)?.commentary[0]?.getContext).toBeNull();
  });

  it("does not cache a partial final snapshot while more records wait for rendering", async () => {
    const pending: ((html: string[]) => void)[] = [];
    const snapshots: AcliOutputProjection[] = [];
    const stream = new AcliToolOutput(
      () => new Promise((resolve) => pending.push(resolve)),
      (value) => snapshots.push(value),
    );
    stream.appendSnapshot(`${banner}${note("One")}\n`, false);
    stream.appendSnapshot(`${banner}${note("One")}\n${note("Two")}\n`, true);
    pending.shift()!(["<p>One</p>"]);
    await tick();
    expect(snapshots.at(-1)?.complete).toBe(false);
    pending.shift()!(["<p>Two</p>"]);
    await tick();
    expect(snapshots.at(-1)?.complete).toBe(true);
    expect(snapshots.at(-1)?.commentary).toHaveLength(2);
  });

  it("retains raw output on rendering failure and stops publication after unmount", async () => {
    const snapshots: AcliOutputProjection[] = [];
    const source = `${note("Keep me")}\n`;
    const stream = new AcliToolOutput(
      async () => {
        throw new Error("Offline");
      },
      (value) => snapshots.push(value),
    );
    stream.appendSnapshot(banner + source, true);
    await tick();
    expect(snapshots.at(-1)).toMatchObject({
      stdout: source,
      commentary: [],
      failed: true,
    });
    const stopped = new AcliToolOutput(
      async () => ["<p>Late</p>"],
      (value) => snapshots.push(value),
    );
    stopped.appendSnapshot(banner + source, true);
    stopped.stop();
    await tick();
    expect(snapshots).toHaveLength(1);
  });
});
