/**
 * Paid probe for plan 150 step 3: does a caller-chosen Claude session id
 * behave like an SDK-assigned one? Runs a handful of short Haiku turns against
 * the pinned Agent SDK and the `claude` CLI on PATH, in a throwaway project
 * directory, and checks:
 *
 * - a new session started with `sessionId` writes `<id>.jsonl` and reports
 *   that id;
 * - a later `resume` in a fresh process continues the same file and context;
 * - `claude --resume <id>` continues it from the CLI;
 * - `resume` + `forkSession` + `sessionId` produces a child under the chosen
 *   id with the parent's history, matching the standalone `forkSession()`;
 * - the same with `resumeSessionAt` keeps only the prefix up to that point;
 * - an id that already exists, or `sessionId` with `resume` but without
 *   `forkSession`, is refused rather than appending to another session.
 *
 * Usage (from packages/server):
 *   pnpm exec tsx scripts/probe-claude-session-id.ts
 *   PROBE_CLAUDE_CONFIG_DIR=/tmp/claude-probe pnpm exec tsx scripts/probe-claude-session-id.ts
 *
 * By default it uses the normal Claude config directory, so the existing login
 * applies; transcripts land in that directory's `projects/` folder for the
 * throwaway project, which is deleted afterwards.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  forkSession,
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

const run = promisify(execFile);
const configDir =
  process.env.PROBE_CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
// The standalone forkSession() reads this process's environment.
process.env.CLAUDE_CONFIG_DIR = configDir;
const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
const model = process.env.PROBE_MODEL ?? "haiku";

interface Turn {
  initSessionId?: string;
  resultSessionId?: string;
  text: string;
  error?: string;
  assistantUuids: string[];
}

const results: Array<{ check: string; pass: boolean; detail: string }> = [];
function record(check: string, pass: boolean, detail = "") {
  results.push({ check, pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${check}${detail ? ` — ${detail}` : ""}`,
  );
}

async function turn(
  cwd: string,
  prompt: string,
  options: Partial<Options>,
): Promise<Turn> {
  const out: Turn = { text: "", assistantUuids: [] };
  try {
    for await (const message of query({
      prompt,
      options: {
        cwd,
        model,
        env,
        maxTurns: 1,
        allowedTools: [],
        settingSources: [],
        permissionMode: "default",
        ...options,
      },
    }) as AsyncIterable<SDKMessage>) {
      if (message.type === "system" && message.subtype === "init") {
        out.initSessionId = message.session_id;
      } else if (message.type === "assistant") {
        out.assistantUuids.push(message.uuid);
        for (const block of message.message.content) {
          if (block.type === "text") out.text += block.text;
        }
      } else if (message.type === "result") {
        out.resultSessionId = message.session_id;
        if (message.subtype !== "success") {
          out.error = `${message.subtype}: ${JSON.stringify(
            "errors" in message ? message.errors : message,
          )}`;
        }
      }
    }
  } catch (error) {
    out.error = error instanceof Error ? error.message : String(error);
  }
  return out;
}

async function transcriptDir(cwd: string): Promise<string> {
  const projects = join(configDir, "projects");
  const slug = (await realpath(cwd)).replace(/[^a-zA-Z0-9]/g, "-");
  return join(projects, slug);
}

/** Session transcripts only; the CLI may also add folders such as `memory`. */
async function transcripts(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
}

async function transcriptLines(dir: string, id: string): Promise<unknown[]> {
  const file = join(dir, `${id}.jsonl`);
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function conversation(lines: unknown[]): string[] {
  return lines.flatMap((line) => {
    const entry = line as {
      type?: string;
      message?: { content?: unknown };
    };
    if (entry.type !== "user" && entry.type !== "assistant") return [];
    const content = entry.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((block) => block?.type === "text")
              .map((block) => block.text)
              .join("")
          : "";
    return text ? [`${entry.type}: ${text.trim()}`] : [];
  });
}

async function main() {
  const cwd = await mkdtemp(join(tmpdir(), "ya-session-id-probe-"));
  const dir = await transcriptDir(cwd);
  console.log(`config=${configDir}\ncwd=${cwd}\ntranscripts=${dir}\n`);
  try {
    // 1. New session under a chosen id.
    const parent = randomUUID();
    const first = await turn(
      cwd,
      "Remember the code word PLUM. Reply with just OK.",
      { sessionId: parent },
    );
    record(
      "new session reports the chosen id",
      !first.error &&
        first.initSessionId === parent &&
        first.resultSessionId === parent,
      first.error ??
        `init=${first.initSessionId} result=${first.resultSessionId}`,
    );
    const files = await transcripts(dir);
    record(
      "new session writes <id>.jsonl and nothing else",
      files.length === 1 && files[0] === `${parent}.jsonl`,
      files.join(", "),
    );

    // 2. Second turn adds a later fact, for the sliced fork below.
    const second = await turn(
      cwd,
      "Also remember the second code word KIWI. Reply with just OK.",
      { resume: parent },
    );
    const afterResume = await transcriptLines(dir, parent);
    record(
      "resume in a fresh process keeps the id and file",
      !second.error &&
        second.initSessionId === parent &&
        (await transcripts(dir)).length === 1,
      second.error ?? `init=${second.initSessionId}`,
    );

    // 3. CLI resume.
    const cli = await run(
      "claude",
      [
        "--resume",
        parent,
        "-p",
        "What were the two code words? Reply with just the two words.",
        "--model",
        model,
        "--max-turns",
        "1",
      ],
      { cwd, env, timeout: 120_000 },
    ).catch((error: Error & { stdout?: string; stderr?: string }) => ({
      stdout: error.stdout ?? "",
      stderr: `${error.message}\n${error.stderr ?? ""}`,
    }));
    const afterCli = await transcriptLines(dir, parent);
    record(
      "CLI resume continues the same session with its context",
      /plum/i.test(cli.stdout) &&
        /kiwi/i.test(cli.stdout) &&
        afterCli.length > afterResume.length &&
        (await transcripts(dir)).length === 1,
      `${cli.stdout.trim().slice(0, 80)} lines ${afterResume.length}->${afterCli.length} files=${(await transcripts(dir)).join(",")}`,
    );

    // 4. Fork under a chosen child id through a launch.
    const child = randomUUID();
    const parentBefore = await readFile(join(dir, `${parent}.jsonl`), "utf8");
    const forked = await turn(
      cwd,
      "What were the two code words? Reply with just the two words.",
      { resume: parent, forkSession: true, sessionId: child },
    );
    const parentAfter = await readFile(join(dir, `${parent}.jsonl`), "utf8");
    const childLines = await transcriptLines(dir, child);
    record(
      "launch fork reports the chosen child id",
      !forked.error &&
        forked.initSessionId === child &&
        forked.resultSessionId === child,
      forked.error ?? `init=${forked.initSessionId}`,
    );
    record(
      "launch fork keeps the parent's context and leaves the parent untouched",
      /plum/i.test(forked.text) &&
        /kiwi/i.test(forked.text) &&
        parentAfter === parentBefore &&
        childLines.length > 0,
      forked.text.trim().slice(0, 80),
    );

    // 5. Compare with the standalone forkSession() YA uses today.
    const standalone = await forkSession(parent, { dir: cwd });
    const standaloneLines = await transcriptLines(dir, standalone.sessionId);
    const parentConversation = conversation(afterCli);
    const childPrefix = conversation(childLines).slice(
      0,
      parentConversation.length,
    );
    record(
      "launch fork's history matches the parent like standalone forkSession()",
      JSON.stringify(childPrefix) === JSON.stringify(parentConversation) &&
        JSON.stringify(conversation(standaloneLines)) ===
          JSON.stringify(parentConversation),
      `parent=${parentConversation.length} child=${conversation(childLines).length} standalone=${conversation(standaloneLines).length}`,
    );
    const uuids = (lines: unknown[]) =>
      new Set(
        lines
          .map((line) => (line as { uuid?: string }).uuid)
          .filter((uuid): uuid is string => Boolean(uuid)),
      );
    const parentUuids = uuids(afterCli);
    const sharedChild = [...uuids(childLines)].filter((uuid) =>
      parentUuids.has(uuid),
    ).length;
    const sharedStandalone = [...uuids(standaloneLines)].filter((uuid) =>
      parentUuids.has(uuid),
    ).length;
    record(
      "message uuids: launch fork vs standalone forkSession()",
      true,
      `shared with parent: launch=${sharedChild} standalone=${sharedStandalone}`,
    );

    // 6. Sliced fork at the end of the first turn.
    const sliced = randomUUID();
    const slicedTurn = await turn(
      cwd,
      "List every code word I asked you to remember. Reply with just the words.",
      {
        resume: parent,
        forkSession: true,
        sessionId: sliced,
        resumeSessionAt: first.assistantUuids.at(-1),
      },
    );
    record(
      "sliced launch fork keeps only the prefix",
      !slicedTurn.error &&
        slicedTurn.initSessionId === sliced &&
        /plum/i.test(slicedTurn.text) &&
        !/kiwi/i.test(slicedTurn.text),
      slicedTurn.error ?? slicedTurn.text.trim().slice(0, 80),
    );

    // 8. A clone sends no turn: does a launch fork create the child anyway?
    const idle = randomUUID();
    const abortController = new AbortController();
    // The SDK may wait for a first prompt before it starts; give up after 20 s.
    const idleTimer = setTimeout(() => abortController.abort(), 20_000);
    let idleInit: string | undefined;
    let idleError: string | undefined;
    try {
      const never = new Promise<void>((resolve) =>
        abortController.signal.addEventListener("abort", () => resolve()),
      );
      for await (const message of query({
        // Never yields a prompt: the stream ends when the probe aborts.
        prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
          await never;
          yield* [];
        })(),
        options: {
          cwd,
          model,
          env,
          settingSources: [],
          resume: parent,
          forkSession: true,
          sessionId: idle,
          abortController,
        },
      }) as AsyncIterable<SDKMessage>) {
        if (message.type === "system" && message.subtype === "init") {
          idleInit = message.session_id;
          break;
        }
      }
    } catch (error) {
      idleError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(idleTimer);
      abortController.abort();
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const idleLines = await transcriptLines(dir, idle);
    record(
      "launch fork without a turn: init and child transcript",
      true,
      `init=${idleInit ?? "none"} childLines=${idleLines.length} error=${idleError?.slice(0, 120) ?? "none"}`,
    );

    // 7. Refusals.
    const before = await readFile(join(dir, `${parent}.jsonl`), "utf8");
    const reuse = await turn(cwd, "Reply with just OK.", { sessionId: parent });
    const after = await readFile(join(dir, `${parent}.jsonl`), "utf8");
    record(
      "an existing id is refused, not appended to",
      Boolean(reuse.error) && after === before,
      reuse.error?.slice(0, 160) ?? `init=${reuse.initSessionId}`,
    );
    const noFork = await turn(cwd, "Reply with just OK.", {
      resume: parent,
      sessionId: randomUUID(),
    });
    record(
      "sessionId with resume but without forkSession is refused",
      Boolean(noFork.error),
      noFork.error?.slice(0, 160) ?? `init=${noFork.initSessionId}`,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
  const failed = results.filter((result) => !result.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  process.exitCode = failed.length ? 1 : 0;
}

await main();
