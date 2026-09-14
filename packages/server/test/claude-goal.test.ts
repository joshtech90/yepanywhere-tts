import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SlashCommand } from "@yep-anywhere/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeGoalTracker,
  parseClaudeGoalControl,
  runClaudeGoalCommand,
  withClaudeGoalDetails,
} from "../src/sdk/providers/claude-goal.js";

const SESSION_ID = "session-1";

/** One transcript row of each shape Claude Code writes for `/goal`. */
const goalRow = (
  condition: string,
  kind: "set" | "cleared" | "met" | "impossible",
) =>
  `${JSON.stringify({
    type: "attachment",
    attachment: {
      type: "goal_status",
      condition,
      met: kind === "cleared" || kind === "met",
      ...(kind === "set" || kind === "cleared" ? { sentinel: true } : {}),
      ...(kind === "impossible" ? { met: false, failed: true } : {}),
    },
  })}\n`;

describe("parseClaudeGoalControl", () => {
  it("separates controls from an objective", () => {
    expect(parseClaudeGoalControl(undefined)).toEqual({ kind: "read" });
    expect(parseClaudeGoalControl("  ")).toEqual({ kind: "read" });
    expect(parseClaudeGoalControl("clear")).toEqual({ kind: "clear" });
    // Claude Code accepts these spellings for clearing too.
    expect(parseClaudeGoalControl("Cancel")).toEqual({ kind: "clear" });
    expect(parseClaudeGoalControl("pause")).toEqual({ kind: "pause" });
    expect(parseClaudeGoalControl("resume")).toEqual({ kind: "resume" });
    expect(parseClaudeGoalControl("  ship the fix  ")).toEqual({
      kind: "set",
      objective: "ship the fix",
    });
  });
});

describe("ClaudeGoalTracker", () => {
  let transcript: string;
  let tracker: ClaudeGoalTracker;
  let contents: string;

  const append = async (line: string) => {
    contents += line;
    await writeFile(transcript, contents);
  };

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "ya-claude-goal-"));
    transcript = join(dir, `${SESSION_ID}.jsonl`);
    contents = "";
    await writeFile(transcript, contents);
    tracker = new ClaudeGoalTracker(dir, null, () => transcript);
    tracker.attachSession(SESSION_ID);
  });

  it("reports the goal Claude installed, and its replacement", async () => {
    await append(goalRow("ship the fix", "set"));
    expect(await tracker.refresh()).toBe(true);
    expect(tracker.snapshot).toEqual({
      objective: "ship the fix",
      status: "active",
    });

    // Claude replaces the Stop hook rather than stacking a second one.
    await append(goalRow("ship the other fix", "set"));
    expect(await tracker.refresh()).toBe(true);
    expect(tracker.snapshot).toEqual({
      objective: "ship the other fix",
      status: "active",
    });
  });

  it("clears the flag when Claude judges the goal met or impossible", async () => {
    await append(goalRow("ship the fix", "set"));
    await tracker.refresh();
    await append(goalRow("ship the fix", "met"));
    expect(await tracker.refresh()).toBe(true);
    expect(tracker.snapshot).toEqual({ objective: null, status: null });

    await append(goalRow("go back to 1999", "set"));
    await tracker.refresh();
    await append(goalRow("go back to 1999", "impossible"));
    await tracker.refresh();
    expect(tracker.snapshot).toEqual({ objective: null, status: null });
  });

  it("keeps a paused objective when the clear was YA's own pause", async () => {
    await append(goalRow("ship the fix", "set"));
    await tracker.refresh();

    tracker.notePauseRequested("ship the fix");
    await append(goalRow("ship the fix", "cleared"));
    await tracker.refresh();
    expect(tracker.snapshot).toEqual({
      objective: "ship the fix",
      status: "paused",
    });

    // A clear of some other goal is a real clear, not a pause.
    await append(goalRow("ship something else", "cleared"));
    await tracker.refresh();
    expect(tracker.snapshot).toEqual({ objective: null, status: null });
  });

  it("restores a paused goal that only YA knows about", async () => {
    const restored = new ClaudeGoalTracker(
      "/tmp",
      { objective: "ship the fix", status: "paused" },
      () => transcript,
    );
    expect(restored.snapshot).toEqual({
      objective: "ship the fix",
      status: "paused",
    });
    // An active goal is not restored: Claude reinstalls that hook itself.
    const notRestored = new ClaudeGoalTracker(
      "/tmp",
      { objective: "ship the fix", status: "active" },
      () => transcript,
    );
    expect(notRestored.snapshot).toEqual({ objective: null, status: null });
  });
});

describe("runClaudeGoalCommand", () => {
  let transcript: string;
  let tracker: ClaudeGoalTracker;
  let contents: string;
  let sent: string[];

  const append = async (line: string) => {
    contents += line;
    await writeFile(transcript, contents);
  };

  /** Stand in for the Claude CLI: apply the command it was handed. */
  const claudeApplies = (text: string) => {
    sent.push(text);
    const argument = text.slice("/goal ".length).trim();
    void (argument === "clear"
      ? append(goalRow(tracker.snapshot.objective ?? "", "cleared"))
      : append(goalRow(argument, "set")));
  };

  const run = (argument: string | undefined, send = claudeApplies) =>
    runClaudeGoalCommand(argument, {
      tracker,
      send,
      confirmationTimeoutMs: 500,
      wait: async () => {},
    });

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "ya-claude-goal-cmd-"));
    transcript = join(dir, `${SESSION_ID}.jsonl`);
    contents = "";
    sent = [];
    await writeFile(transcript, contents);
    tracker = new ClaudeGoalTracker(dir, null, () => transcript);
    tracker.attachSession(SESSION_ID);
  });

  it("sets, reads, and clears through Claude's own command", async () => {
    const set = await run("ship the fix");
    expect(sent).toEqual(["/goal ship the fix"]);
    expect(set.output?.details).toEqual(["ship the fix", "Goal set"]);

    const read = await run(undefined);
    expect(read.output?.details).toEqual(["ship the fix", "Goal active"]);

    const cleared = await run("clear");
    expect(sent).toEqual(["/goal ship the fix", "/goal clear"]);
    expect(cleared.output?.details).toEqual(["Goal cleared"]);
    expect(tracker.snapshot).toEqual({ objective: null, status: null });
  });

  it("reissuing the live objective reads it instead of spending a turn", async () => {
    await run("ship the fix");
    sent = [];
    const again = await run("ship the fix");
    expect(sent).toEqual([]);
    expect(again.output?.details).toEqual(["ship the fix", "Goal active"]);
  });

  it("pauses by releasing Claude's hook and resumes by reinstalling it", async () => {
    await run("ship the fix");
    sent = [];

    const paused = await run("pause");
    expect(sent).toEqual(["/goal clear"]);
    expect(paused.output?.details).toEqual(["ship the fix", "Goal paused"]);
    expect(tracker.snapshot).toEqual({
      objective: "ship the fix",
      status: "paused",
    });

    const resumed = await run("resume");
    expect(sent).toEqual(["/goal clear", "/goal ship the fix"]);
    expect(resumed.output?.details).toEqual(["ship the fix", "Goal resumed"]);
    expect(tracker.snapshot).toEqual({
      objective: "ship the fix",
      status: "active",
    });
  });

  it("clears a paused goal without sending Claude anything", async () => {
    await run("ship the fix");
    await run("pause");
    sent = [];

    const cleared = await run("clear");
    expect(sent).toEqual([]);
    expect(cleared.output?.details).toEqual(["Goal cleared"]);
    expect(tracker.snapshot).toEqual({ objective: null, status: null });
  });

  it("refuses controls that have no goal to act on", async () => {
    expect((await run("pause")).error).toBe("No active goal to pause");
    expect((await run("resume")).error).toBe("No paused goal to resume");
    expect((await run("clear")).output?.details).toEqual(["No goal to clear"]);
    expect(sent).toEqual([]);
  });

  it("reports an unconfirmed transition rather than claiming success", async () => {
    // A refused `/goal` (untrusted workspace, restricted hooks) writes no row.
    const result = await run("ship the fix", (text) => {
      sent.push(text);
    });
    expect(result.output?.details).toEqual([
      "ship the fix",
      "Goal requested; Claude has not confirmed it yet",
    ]);
    expect(tracker.snapshot).toEqual({ objective: null, status: null });
  });
});

describe("withClaudeGoalDetails", () => {
  const nativeGoal: SlashCommand = {
    name: "goal",
    description: "Set a goal Claude checks before stopping",
    argumentHint: "[<condition> | clear]",
  };

  it("publishes goal state and the controls that apply to it", () => {
    const [command] = withClaudeGoalDetails([nativeGoal], {
      objective: "ship the fix",
      status: "active",
    });
    expect(command?.providerDetails?.claude).toEqual({
      goalObjective: "ship the fix",
      goalStatus: "active",
    });
    expect(command?.argumentCompletions?.map((option) => option.value)).toEqual(
      ["ship the fix", "clear", "pause"],
    );

    const [paused] = withClaudeGoalDetails([nativeGoal], {
      objective: "ship the fix",
      status: "paused",
    });
    expect(paused?.argumentCompletions?.map((option) => option.value)).toEqual([
      "ship the fix",
      "clear",
      "resume",
    ]);
  });

  it("reports a cleared goal as known-empty, not unknown", () => {
    const [command] = withClaudeGoalDetails([nativeGoal], {
      objective: null,
      status: null,
    });
    expect(command?.providerDetails?.claude).toEqual({
      goalObjective: null,
      goalStatus: null,
    });
  });

  it("leaves YA's emulated goal alias alone", () => {
    const alias: SlashCommand = {
      name: "goal",
      description: "Keep working toward a verifiable end state until it is met",
      emulation: { providerText: "/loop wish {{argument}}" },
      invocation: { kind: "emulated", prefix: "/" },
    };
    expect(
      withClaudeGoalDetails([alias], { objective: "x", status: "active" }),
    ).toEqual([alias]);
  });
});
