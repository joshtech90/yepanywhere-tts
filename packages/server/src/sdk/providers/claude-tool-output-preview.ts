import { open, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_OUTPUT_PREVIEW_MESSAGE_TYPE } from "@yep-anywhere/shared";
import type { SDKMessage } from "../types.js";
import { renderLiveToolOutput } from "./live-tool-output.js";

/**
 * Live output for running Claude Bash calls.
 *
 * The Claude SDK sends nothing for a Bash call until it finishes, but the CLI
 * streams the command's combined stdout/stderr to
 * `<tmp>/claude-<uid>/<cwd-slug>/<session>/tasks/<task_id>.output` and
 * announces the task with a `task_started` message naming its tool call.
 * This tails that file and publishes a bounded preview as a
 * `tool_output_preview` message, which clients show on the pending tool row
 * and the model never sees. The file layout is CLI-internal, so a file that
 * cannot be found only means no preview.
 */

export const CLAUDE_TOOL_OUTPUT_POLL_MS = 1_000;
export const CLAUDE_TOOL_OUTPUT_HEAD_BYTES = 2 * 1024;
export const CLAUDE_TOOL_OUTPUT_TAIL_BYTES = 8 * 1024;
/** Polls spent looking for a task's output file before giving up on it. */
const MAX_FILE_LOOKUPS = 5;
/** Ceiling on concurrently tailed calls per session. */
const MAX_TAILS = 8;
/** Ceiling on directories scanned when the cwd-derived guess misses. */
const MAX_SCANNED_PROJECT_DIRS = 1_000;

interface Tail {
  toolUseId: string;
  taskId: string;
  sessionId: string;
  path: string | null;
  lookups: number;
  size: number;
}

export interface ClaudeToolOutputPreviewsOptions {
  cwd: string;
  /** Roots that may hold Claude's per-user temp directory. */
  tmpRoots?: string[];
  pollMs?: number;
}

export function claudeToolOutputPreviewUuid(toolUseId: string): string {
  return `${TOOL_OUTPUT_PREVIEW_MESSAGE_TYPE}:${toolUseId}`;
}

/** Where the Claude CLI launched with `env` may keep its task output files. */
export function claudeToolOutputTmpRoots(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const bases = [env.CLAUDE_CODE_TMPDIR, tmpdir()].filter(
    (base): base is string => !!base,
  );
  const uid = process.getuid?.();
  return bases.flatMap((base) =>
    uid === undefined ? [base] : [join(base, `claude-${uid}`), base],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toolResultIds(message: SDKMessage): string[] {
  const content = message.message?.content;
  if (message.type !== "user" || !Array.isArray(content)) return [];
  return content.flatMap((block) =>
    isRecord(block) &&
    block.type === "tool_result" &&
    typeof block.tool_use_id === "string"
      ? [block.tool_use_id]
      : [],
  );
}

/** Drops UTF-8 continuation bytes a positional read may start inside. */
function decodeFrom(buffer: Buffer): string {
  let start = 0;
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start++;
  return buffer.subarray(start).toString("utf8");
}

export class ClaudeToolOutputPreviews {
  private readonly tails = new Map<string, Tail>();
  private readonly ready: SDKMessage[] = [];
  private readonly cwdSlug: string;
  private readonly tmpRoots: string[];
  private readonly pollMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private wake: (() => void) | null = null;
  private closed = false;

  constructor(options: ClaudeToolOutputPreviewsOptions) {
    this.cwdSlug = options.cwd.replace(/[^A-Za-z0-9]/g, "-");
    this.tmpRoots = options.tmpRoots ?? claudeToolOutputTmpRoots();
    this.pollMs = options.pollMs ?? CLAUDE_TOOL_OUTPUT_POLL_MS;
  }

  observe(message: SDKMessage): void {
    if (this.closed) return;
    if (message.type === "system" && message.subtype === "task_started") {
      if (
        message.task_type === "local_bash" &&
        typeof message.task_id === "string" &&
        typeof message.tool_use_id === "string" &&
        typeof message.session_id === "string"
      ) {
        this.start(message.tool_use_id, message.task_id, message.session_id);
      }
      return;
    }
    if (
      message.type === "system" &&
      message.subtype === "task_notification" &&
      typeof message.tool_use_id === "string"
    ) {
      this.stop(message.tool_use_id);
      return;
    }
    for (const id of toolResultIds(message)) this.stop(id);
  }

  /** Previews published since the last call, oldest first. */
  take(): SDKMessage[] {
    return this.ready.splice(0);
  }

  /** Resolves when a preview is published or tailing closes. */
  waitForPreview(): Promise<void> {
    if (this.ready.length > 0 || this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }

  close(): void {
    this.closed = true;
    this.tails.clear();
    this.ready.length = 0;
    this.stopTimer();
    this.notify();
  }

  private start(toolUseId: string, taskId: string, sessionId: string): void {
    if (this.tails.has(toolUseId) || this.tails.size >= MAX_TAILS) return;
    this.tails.set(toolUseId, {
      toolUseId,
      taskId,
      sessionId,
      path: null,
      lookups: 0,
      size: 0,
    });
    if (!this.timer) {
      this.timer = setInterval(() => void this.poll(), this.pollMs);
      this.timer.unref?.();
    }
  }

  private stop(toolUseId: string): void {
    if (!this.tails.delete(toolUseId)) return;
    const uuid = claudeToolOutputPreviewUuid(toolUseId);
    for (let i = this.ready.length - 1; i >= 0; i--) {
      if (this.ready[i]!.uuid === uuid) this.ready.splice(i, 1);
    }
    if (this.tails.size === 0) this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const tail of this.tails.values()) {
        const content = await this.readTail(tail);
        if (content === null || this.tails.get(tail.toolUseId) !== tail)
          continue;
        this.ready.push({
          type: TOOL_OUTPUT_PREVIEW_MESSAGE_TYPE,
          uuid: claudeToolOutputPreviewUuid(tail.toolUseId),
          session_id: tail.sessionId,
          tool_use_id: tail.toolUseId,
          content,
          _isStreaming: true,
        });
      }
    } finally {
      this.polling = false;
    }
    if (this.ready.length > 0) this.notify();
  }

  /** The new preview text, or null when there is nothing new to show. */
  private async readTail(tail: Tail): Promise<string | null> {
    if (!tail.path) {
      tail.path = await this.findOutputFile(tail);
      if (!tail.path) {
        if (++tail.lookups >= MAX_FILE_LOOKUPS) this.stop(tail.toolUseId);
        return null;
      }
    }
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(tail.path, "r");
    } catch {
      // The CLI deletes a foreground task's file when the command ends.
      return null;
    }
    try {
      const { size } = await handle.stat();
      if (size === tail.size) return null;
      tail.size = size;
      const headBytes = Math.min(size, CLAUDE_TOOL_OUTPUT_HEAD_BYTES);
      const head = Buffer.alloc(headBytes);
      await handle.read(head, 0, headBytes, 0);
      const tailStart = Math.max(
        headBytes,
        size - CLAUDE_TOOL_OUTPUT_TAIL_BYTES,
      );
      const rest = Buffer.alloc(size - tailStart);
      await handle.read(rest, 0, rest.length, tailStart);
      return renderLiveToolOutput(
        {
          head: head.toString("utf8"),
          tail:
            tailStart > headBytes ? decodeFrom(rest) : rest.toString("utf8"),
          omittedChars: tailStart - headBytes,
        },
        "bytes",
      );
    } finally {
      await handle.close();
    }
  }

  private async findOutputFile(tail: Tail): Promise<string | null> {
    const relative = join(tail.sessionId, "tasks", `${tail.taskId}.output`);
    for (const root of this.tmpRoots) {
      const guess = join(root, this.cwdSlug, relative);
      if (await isReadable(guess)) return guess;
    }
    for (const root of this.tmpRoots) {
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch {
        continue;
      }
      for (const entry of entries.slice(0, MAX_SCANNED_PROJECT_DIRS)) {
        const candidate = join(root, entry, relative);
        if (await isReadable(candidate)) return candidate;
      }
    }
    return null;
  }
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await (await open(path, "r")).close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Interleaves live Bash output previews with a Claude session's messages.
 * Previews are published between provider messages, never inside one, and
 * tailing stops when the session's stream ends.
 */
export async function* withClaudeToolOutputPreviews(
  source: AsyncIterableIterator<SDKMessage>,
  options: ClaudeToolOutputPreviewsOptions,
): AsyncGenerator<SDKMessage> {
  const previews = new ClaudeToolOutputPreviews(options);
  let pending: Promise<IteratorResult<SDKMessage>> | null = null;
  try {
    while (true) {
      for (const preview of previews.take()) yield preview;
      pending ??= source.next();
      const next = await Promise.race([
        pending,
        previews.waitForPreview().then(() => null),
      ]);
      if (next === null) continue;
      pending = null;
      if (next.done) return;
      previews.observe(next.value);
      yield next.value;
    }
  } finally {
    previews.close();
    if (!pending) await source.return?.();
  }
}
