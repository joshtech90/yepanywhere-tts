import { describe, expect, it } from "vitest";
import {
  SessionTokenUsageRecorder,
  type SessionTokenUsageRecord,
} from "../../src/auth/SessionTokenUsageRecorder.js";
import type { Process } from "../../src/supervisor/Process.js";
import type { SDKMessage } from "../../src/sdk/types.js";

/** Contract: topics/limited-users.md § Delivery v1 — Usage. */

/**
 * The recorder reads five fields off a process. A real `Process` needs a live
 * provider to exist, so the test supplies exactly those fields.
 */
function fakeProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: "p1",
    sessionId: "s1",
    provider: "claude",
    projectPath: "/home/archer/code/yepanywhere",
    requestedModel: "opus",
    resolvedModel: "claude-opus-4-5-20251101",
    ...overrides,
  } as unknown as Process;
}

/** A Claude assistant frame as the SDK yields it: usage on the API message. */
function claudeFrame(options: {
  responseId: string;
  input: number;
  cacheRead?: number;
  output: number;
  model?: string;
}): SDKMessage {
  return {
    type: "assistant",
    message: {
      id: options.responseId,
      ...(options.model ? { model: options.model } : {}),
      usage: {
        input_tokens: options.input,
        cache_read_input_tokens: options.cacheRead ?? 0,
        output_tokens: options.output,
      },
    },
  } as unknown as SDKMessage;
}

/** Codex reports out of band, per request, with no response id to dedupe on. */
function codexFrame(options: { input: number; output: number }): SDKMessage {
  return {
    type: "system",
    subtype: "token_usage",
    usage: {
      input_tokens: options.input,
      cached_input_tokens: 0,
      output_tokens: options.output,
    },
  } as unknown as SDKMessage;
}

function recorderWithLog() {
  const records: SessionTokenUsageRecord[] = [];
  const recorder = new SessionTokenUsageRecorder({
    record: (record) => records.push(record),
    resolveUsername: (sessionId) => (sessionId === "s1" ? "archer" : undefined),
  });
  return { recorder, records };
}

describe("SessionTokenUsageRecorder", () => {
  it("appends one charge per settled turn, named by user, model and project", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 100, cacheRead: 900, output: 50 }),
    );
    recorder.flush(process);

    expect(records).toEqual([
      {
        username: "archer",
        model: "opus",
        modelId: "claude-opus-4-5-20251101",
        project: "yepanywhere",
        provider: "claude",
        longContext: false,
        // The classes stay apart: 900 of the 1000-token prompt was a cache
        // read, which costs a tenth of the 100 tokens actually processed.
        freshInputTokens: 100,
        cachedInputTokens: 900,
        cacheWriteTokens: 0,
        outputTokens: 50,
      },
    ]);
  });

  it("prices each request at the model its frame names, not the alias", () => {
    const { recorder, records } = recorderWithLog();
    // Before any reply the process only knows its launch alias.
    const process = fakeProcess({ resolvedModel: "opus" });

    recorder.observeMessage(
      process,
      claudeFrame({
        responseId: "main",
        input: 100,
        output: 50,
        model: "claude-opus-5-5",
      }),
    );
    // A subagent on another model is billed at that model.
    recorder.observeMessage(
      process,
      claudeFrame({
        responseId: "sub",
        input: 10,
        output: 5,
        model: "claude-haiku-4-5",
      }),
    );
    recorder.flush(process);

    expect(records.map((record) => record.modelId)).toEqual([
      "claude-opus-5-5",
      "claude-haiku-4-5",
    ]);
    expect(records.map((record) => record.outputTokens)).toEqual([50, 5]);
  });

  it("counts one response once however many frames repeat its usage", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();
    const frame = claudeFrame({ responseId: "r1", input: 1000, output: 50 });

    recorder.observeMessage(process, frame);
    recorder.observeMessage(process, frame);
    recorder.observeMessage(process, frame);
    recorder.flush(process);

    expect(records[0]).toMatchObject({
      freshInputTokens: 1000,
      outputTokens: 50,
    });
  });

  it("sums the separate requests one turn makes", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r2", input: 1200, output: 30 }),
    );
    recorder.flush(process);

    expect(records[0]).toMatchObject({
      freshInputTokens: 2200,
      outputTokens: 80,
    });
  });

  it("takes each out-of-band frame as its own request", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ provider: "codex" } as Partial<Process>);

    // Two real requests can legitimately report equal counts, so equality is
    // not evidence of a repeat when the provider names no response.
    recorder.observeMessage(process, codexFrame({ input: 500, output: 20 }));
    recorder.observeMessage(process, codexFrame({ input: 500, output: 20 }));
    recorder.flush(process);

    expect(records[0]).toMatchObject({
      freshInputTokens: 1000,
      outputTokens: 40,
    });
  });

  it("appends nothing when a turn produced no usage", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.flush(process);
    recorder.observeMessage(process, { type: "user" } as SDKMessage);
    recorder.flush(process);

    expect(records).toEqual([]);
  });

  it("starts over after a flush, so one charge is never appended twice", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.flush(process);
    recorder.flush(process);

    expect(records).toHaveLength(1);
  });

  it("still owes the last turn's charge when the process goes away", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.forgetProcess(process);

    expect(records).toHaveLength(1);
  });

  it("bins a long-context request apart from a short one", () => {
    const { recorder, records } = recorderWithLog();
    // OpenAI's tier starts above 272k; Anthropic has none at all.
    const process = fakeProcess({ provider: "codex" } as Partial<Process>);

    recorder.observeMessage(process, codexFrame({ input: 1000, output: 50 }));
    recorder.observeMessage(
      process,
      codexFrame({ input: 300_000, output: 60 }),
    );
    recorder.flush(process);

    // One turn, two price lists: the tier is each request's own prompt length,
    // so the short request is not dragged into the premium by the long one.
    expect(records.map((record) => record.longContext)).toEqual([false, true]);
    expect(records[0]).toMatchObject({ freshInputTokens: 1000 });
    expect(records[1]).toMatchObject({ freshInputTokens: 300_000 });
  });

  it("never flags a Claude request long, its 1M window being priced flat", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 900_000, output: 60 }),
    );
    recorder.flush(process);

    expect(records).toHaveLength(1);
    expect(records[0]?.longContext).toBe(false);
  });

  it("flags a Haiku 5.5 request past 100k, its model having its own tier", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ resolvedModel: "claude-opus-5-5" });

    // A subagent on Haiku 5.5 is tiered by Haiku's threshold, not the
    // session's model; cache reads count toward the prompt.
    recorder.observeMessage(
      process,
      claudeFrame({
        responseId: "short",
        input: 1000,
        cacheRead: 99_000,
        output: 10,
        model: "claude-haiku-5-5",
      }),
    );
    recorder.observeMessage(
      process,
      claudeFrame({
        responseId: "long",
        input: 1000,
        cacheRead: 99_001,
        output: 10,
        model: "claude-haiku-5-5",
      }),
    );
    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "main", input: 300_000, output: 10 }),
    );
    recorder.flush(process);

    expect(
      records.map((record) => [record.modelId, record.longContext]),
    ).toEqual([
      ["claude-haiku-5-5", false],
      ["claude-opus-5-5", false],
      ["claude-haiku-5-5", true],
    ]);
  });

  it("does not flag an OpenAI request at exactly the threshold", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ provider: "codex" } as Partial<Process>);

    recorder.observeMessage(
      process,
      codexFrame({ input: 272_000, output: 10 }),
    );
    recorder.flush(process);

    expect(records[0]?.longContext).toBe(false);
  });

  it("counts a subagent's requests, interleaved with the main thread's", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();
    const main = claudeFrame({ responseId: "main", input: 1000, output: 50 });
    const subagent = {
      ...claudeFrame({ responseId: "task", input: 300, output: 20 }),
      parent_tool_use_id: "toolu_task",
    } as SDKMessage;

    // The main response's later content block arrives after the subagent's
    // frame, and still repeats a response already counted.
    recorder.observeMessage(process, main);
    recorder.observeMessage(process, subagent);
    recorder.observeMessage(process, main);
    recorder.observeMessage(process, subagent);
    recorder.flush(process);

    expect(records[0]).toMatchObject({
      freshInputTokens: 1300,
      outputTokens: 70,
    });
  });

  it("does not count Claude's result, which restates its requests", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.observeMessage(process, {
      type: "result",
      usage: { input_tokens: 1000, output_tokens: 50 },
    } as unknown as SDKMessage);
    recorder.flush(process);

    expect(records[0]).toMatchObject({
      freshInputTokens: 1000,
      outputTokens: 50,
    });
  });

  it("does not count Codex's turn_complete, which restates its requests", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ provider: "codex" } as Partial<Process>);

    recorder.observeMessage(process, codexFrame({ input: 500, output: 20 }));
    recorder.observeMessage(process, {
      type: "system",
      subtype: "turn_complete",
      usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 20 },
    } as unknown as SDKMessage);
    recorder.flush(process);

    expect(records[0]).toMatchObject({
      freshInputTokens: 500,
      outputTokens: 20,
    });
  });

  it("reads a local Codex service's turn total, its cached reads inside input", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ provider: "codex-oss" } as Partial<Process>);

    recorder.observeMessage(process, {
      type: "system",
      subtype: "turn_complete",
      usage: {
        input_tokens: 400_000,
        cached_input_tokens: 350_000,
        output_tokens: 90,
      },
    } as unknown as SDKMessage);
    recorder.flush(process);

    // A turn total names no single request, so a sum past OpenAI's 272k does
    // not put the turn in the long-context tier.
    expect(records).toEqual([
      expect.objectContaining({
        provider: "codex-oss",
        longContext: false,
        freshInputTokens: 50_000,
        cachedInputTokens: 350_000,
        cacheWriteTokens: 0,
        outputTokens: 90,
      }),
    ]);
  });

  it("reads pi's usage from its turn result", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ provider: "pi" } as Partial<Process>);

    recorder.observeMessage(process, {
      type: "result",
      usage: {
        input_tokens: 13,
        output_tokens: 11,
        cache_read_input_tokens: 24,
        cache_creation_input_tokens: 3,
      },
    } as unknown as SDKMessage);
    recorder.flush(process);

    expect(records).toEqual([
      expect.objectContaining({
        provider: "pi",
        freshInputTokens: 13,
        cachedInputTokens: 24,
        cacheWriteTokens: 3,
        outputTokens: 11,
      }),
    ]);
  });

  it("reads OpenCode's usage from its turn result", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ provider: "opencode" } as Partial<Process>);

    recorder.observeMessage(process, {
      type: "result",
      usage: {
        input_tokens: 120,
        output_tokens: 40,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 60,
      },
    } as unknown as SDKMessage);
    recorder.flush(process);

    expect(records).toEqual([
      expect.objectContaining({
        provider: "opencode",
        freshInputTokens: 120,
        cachedInputTokens: 800,
        cacheWriteTokens: 60,
        outputTokens: 40,
      }),
    ]);
  });

  it("leaves the username absent for the superuser", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ sessionId: "unowned" });

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.flush(process);

    expect(records[0]?.username).toBe(undefined);
  });
});
