import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_TOOL_OUTPUT_HEAD_BYTES,
  CLAUDE_TOOL_OUTPUT_TAIL_BYTES,
  claudeToolOutputPreviewUuid,
  withClaudeToolOutputPreviews,
} from "../../../src/sdk/providers/claude-tool-output-preview.js";
import type { SDKMessage } from "../../../src/sdk/types.js";

const SESSION = "11111111-2222-3333-4444-555555555555";
const CWD = "/work/my.project";

/** A source the test feeds one message at a time. */
function controlledSource() {
  const queued: SDKMessage[] = [];
  let waiting: ((result: IteratorResult<SDKMessage>) => void) | null = null;
  let ended = false;
  const source: AsyncIterableIterator<SDKMessage> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      const message = queued.shift();
      if (message) return Promise.resolve({ done: false, value: message });
      if (ended) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
  };
  return {
    source,
    push(message: SDKMessage) {
      const resolve = waiting;
      waiting = null;
      if (resolve) resolve({ done: false, value: message });
      else queued.push(message);
    },
    end() {
      ended = true;
      waiting?.({ done: true, value: undefined });
    },
  };
}

function taskStarted(toolUseId: string, taskId: string): SDKMessage {
  return {
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: toolUseId,
    task_type: "local_bash",
    is_backgrounded: false,
    session_id: SESSION,
  };
}

function toolResult(toolUseId: string): SDKMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: "" }],
    },
  };
}

describe("withClaudeToolOutputPreviews", () => {
  let root: string;
  let tasks: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "claude-preview-test-"));
    tasks = join(root, "-work-my-project", SESSION, "tasks");
    await mkdir(tasks, { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true });
  });

  function start() {
    const control = controlledSource();
    const messages = withClaudeToolOutputPreviews(control.source, {
      cwd: CWD,
      tmpRoots: [root],
      pollMs: 10,
    });
    return { control, messages };
  }

  it("publishes a running command's output until its result arrives", async () => {
    const { control, messages } = start();
    const output = join(tasks, "task1.output");
    await writeFile(output, "tick 1\n");

    const started = taskStarted("toolu_1", "task1");
    control.push(started);
    expect((await messages.next()).value).toBe(started);

    const first = (await messages.next()).value;
    expect(first).toMatchObject({
      type: "tool_output_preview",
      uuid: claudeToolOutputPreviewUuid("toolu_1"),
      tool_use_id: "toolu_1",
      session_id: SESSION,
      content: "tick 1\n",
      _isStreaming: true,
    });

    await appendFile(output, "tick 2\n");
    expect((await messages.next()).value).toMatchObject({
      content: "tick 1\ntick 2\n",
    });

    const result = toolResult("toolu_1");
    control.push(result);
    expect((await messages.next()).value).toBe(result);
    await appendFile(output, "after the result\n");
    control.end();
    expect((await messages.next()).done).toBe(true);
  });

  it("keeps the head and tail of long output", async () => {
    const { control, messages } = start();
    const head = "h".repeat(CLAUDE_TOOL_OUTPUT_HEAD_BYTES);
    const middle = "m".repeat(5000);
    const tail = "t".repeat(CLAUDE_TOOL_OUTPUT_TAIL_BYTES);
    await writeFile(join(tasks, "task2.output"), head + middle + tail);

    control.push(taskStarted("toolu_2", "task2"));
    await messages.next();
    const preview = (await messages.next()).value as SDKMessage;
    expect(preview.content).toBe(
      `${head}\n… 5000 bytes omitted from the live preview; the completed result shows the full output …\n${tail}`,
    );
    control.end();
  });

  it("finds the file by session when the cwd-derived directory differs", async () => {
    const { control, messages } = start();
    const elsewhere = join(root, "-renamed-project", SESSION, "tasks");
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(elsewhere, "task3.output"), "found\n");

    control.push(taskStarted("toolu_3", "task3"));
    await messages.next();
    expect((await messages.next()).value).toMatchObject({ content: "found\n" });
    control.end();
  });

  it("ignores tasks other than local Bash", async () => {
    const { control, messages } = start();
    await writeFile(join(tasks, "task4.output"), "agent output\n");
    const agentTask = {
      ...taskStarted("toolu_4", "task4"),
      task_type: "local_agent",
    };

    control.push(agentTask);
    expect((await messages.next()).value).toBe(agentTask);
    const after = toolResult("toolu_4");
    setTimeout(() => control.push(after), 50);
    expect((await messages.next()).value).toBe(after);
    control.end();
  });
});
