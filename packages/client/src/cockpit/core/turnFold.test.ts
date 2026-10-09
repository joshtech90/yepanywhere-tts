import { describe, expect, it } from "vitest";
import type {
  CockpitAssistantEntry,
  CockpitBoundaryEntry,
  CockpitToolEntry,
  CockpitTranscriptEntry,
  CockpitUserEntry,
} from "./sessionDetail";
import { foldCockpitTurns } from "./turnFold";

function createUserEntry(key: string, text = "User prompt"): CockpitUserEntry {
  return {
    kind: "user",
    key,
    text,
  };
}

function createToolEntry(
  key: string,
  toolName = "Bash",
  id = `tool-call-${key}`,
): CockpitToolEntry {
  return {
    kind: "tool",
    key,
    tool: {} as CockpitToolEntry["tool"],
    sourceItems: [
      {
        type: "tool_call",
        id,
        toolName,
        toolInput: {},
        status: "complete",
        sourceMessages: [],
      },
    ] as unknown as CockpitToolEntry["sourceItems"],
  };
}

function createAssistantEntry(
  key: string,
  options: {
    text?: string;
    thinking?: string;
    isStreaming?: boolean;
    abortedMidStream?: boolean;
    hasText?: boolean;
  } = {},
): CockpitAssistantEntry {
  const isStreaming = options.isStreaming ?? false;
  const abortedMidStream = options.abortedMidStream ?? false;
  const hasText = options.hasText ?? true;

  return {
    kind: "assistant",
    key,
    text: hasText
      ? [
          {
            id: `text-${key}`,
            text: options.text ?? "Assistant response",
            isStreaming,
            abortedMidStream,
          },
        ]
      : [],
    thinking: options.thinking
      ? [
          {
            id: `thinking-${key}`,
            text: options.thinking,
            status: "complete",
          },
        ]
      : [],
    spokenText: "",
    isStreaming,
  };
}

function createBoundaryEntry(
  key: string,
  subtype: "compact_boundary" | "status" = "compact_boundary",
): CockpitBoundaryEntry {
  return {
    kind: "boundary",
    key,
    subtype,
  };
}

describe("foldCockpitTurns", () => {
  it("collapses a finished turn with tools, interim assistant text, and final answer", () => {
    const prompt = createUserEntry("user-1", "Summarize the repository");
    const tool1 = createToolEntry("tool-1", "Bash");
    const interimNote = createAssistantEntry("asst-note", {
      text: "Checking repository structure...",
    });
    const tool2 = createToolEntry("tool-2", "ReadFile");
    const finalAnswer = createAssistantEntry("asst-final", {
      text: "The summary is complete.",
    });

    const entries: CockpitTranscriptEntry[] = [
      prompt,
      tool1,
      interimNote,
      tool2,
      finalAnswer,
    ];

    const result = foldCockpitTurns(entries, {
      expandedFoldKeys: new Set(),
      latestTurnOpen: false,
    });

    expect(result).toEqual([
      prompt,
      {
        kind: "fold",
        key: "user-1\0fold",
        expanded: false,
        steps: 2,
        notes: 1,
      },
      finalAnswer,
    ]);
  });

  it("strips thinking from the final answer and maintains stable object identity across calls", () => {
    const prompt = createUserEntry("user-1");
    const tool = createToolEntry("tool-1");
    const finalAnswerWithThinking = createAssistantEntry("asst-final", {
      text: "Here is your answer.",
      thinking: "Let me consider edge cases first...",
    });

    const entries: CockpitTranscriptEntry[] = [
      prompt,
      tool,
      finalAnswerWithThinking,
    ];

    const firstRun = foldCockpitTurns(entries, {
      expandedFoldKeys: new Set(),
      latestTurnOpen: false,
    });
    const secondRun = foldCockpitTurns(entries, {
      expandedFoldKeys: new Set(),
      latestTurnOpen: false,
    });

    const strippedFirst = firstRun[2] as CockpitAssistantEntry;
    const strippedSecond = secondRun[2] as CockpitAssistantEntry;

    expect(strippedFirst.thinking).toEqual([]);
    expect(strippedFirst.text).toEqual(finalAnswerWithThinking.text);
    expect(finalAnswerWithThinking.thinking).toHaveLength(1);

    expect(strippedFirst).toBe(strippedSecond);
    expect(strippedFirst).not.toBe(finalAnswerWithThinking);
  });

  it("returns prompt, expanded fold row, and the original body in order when expandedFoldKeys contains the key", () => {
    const prompt = createUserEntry("user-1");
    const tool = createToolEntry("tool-1");
    const interimNote = createAssistantEntry("asst-note", {
      text: "In progress...",
    });
    const finalAnswer = createAssistantEntry("asst-final", {
      text: "Done.",
    });

    const entries: CockpitTranscriptEntry[] = [
      prompt,
      tool,
      interimNote,
      finalAnswer,
    ];
    const foldKey = "user-1\0fold";

    const result = foldCockpitTurns(entries, {
      expandedFoldKeys: new Set([foldKey]),
      latestTurnOpen: false,
    });

    expect(result).toHaveLength(5);
    expect(result[0]).toBe(prompt);
    expect(result[1]).toEqual({
      kind: "fold",
      key: foldKey,
      expanded: true,
      steps: 1,
      notes: 1,
    });
    expect(result[2]).toBe(tool);
    expect(result[3]).toBe(interimNote);
    expect(result[4]).toBe(finalAnswer);
  });

  it("leaves only the latest turn untouched when latestTurnOpen is true while earlier turns fold", () => {
    const prompt1 = createUserEntry("user-1");
    const tool1 = createToolEntry("tool-1");
    const answer1 = createAssistantEntry("asst-1", { text: "Answer 1" });

    const prompt2 = createUserEntry("user-2");
    const tool2 = createToolEntry("tool-2");
    const answer2 = createAssistantEntry("asst-2", { text: "Answer 2" });

    const entries: CockpitTranscriptEntry[] = [
      prompt1,
      tool1,
      answer1,
      prompt2,
      tool2,
      answer2,
    ];

    const result = foldCockpitTurns(entries, {
      expandedFoldKeys: new Set(),
      latestTurnOpen: true,
    });

    expect(result).toEqual([
      prompt1,
      {
        kind: "fold",
        key: "user-1\0fold",
        expanded: false,
        steps: 1,
        notes: 0,
      },
      answer1,
      prompt2,
      tool2,
      answer2,
    ]);
  });

  describe("turns ending on a non-final answer are not folded", () => {
    it("does not fold a turn ending on a tool call", () => {
      const prompt = createUserEntry("user-1");
      const tool1 = createToolEntry("tool-1");
      const tool2 = createToolEntry("tool-2");
      const entries: CockpitTranscriptEntry[] = [prompt, tool1, tool2];

      const result = foldCockpitTurns(entries, {
        expandedFoldKeys: new Set(),
        latestTurnOpen: false,
      });

      expect(result).toEqual([prompt, tool1, tool2]);
    });

    it("does not fold a turn ending on a streaming answer", () => {
      const prompt = createUserEntry("user-1");
      const tool = createToolEntry("tool-1");
      const streamingAnswer = createAssistantEntry("asst-stream", {
        text: "Generating...",
        isStreaming: true,
      });
      const entries: CockpitTranscriptEntry[] = [prompt, tool, streamingAnswer];

      const result = foldCockpitTurns(entries, {
        expandedFoldKeys: new Set(),
        latestTurnOpen: false,
      });

      expect(result).toEqual([prompt, tool, streamingAnswer]);
    });

    it("does not fold a turn ending on an abortedMidStream answer", () => {
      const prompt = createUserEntry("user-1");
      const tool = createToolEntry("tool-1");
      const abortedAnswer = createAssistantEntry("asst-aborted", {
        text: "Partial text...",
        abortedMidStream: true,
      });
      const entries: CockpitTranscriptEntry[] = [prompt, tool, abortedAnswer];

      const result = foldCockpitTurns(entries, {
        expandedFoldKeys: new Set(),
        latestTurnOpen: false,
      });

      expect(result).toEqual([prompt, tool, abortedAnswer]);
    });
  });

  it("keeps boundary entries and AskUserQuestion/ExitPlanMode tools visible and does not count them", () => {
    const prompt = createUserEntry("user-1");
    const hiddenTool = createToolEntry("tool-bash", "Bash");
    const boundary = createBoundaryEntry("boundary-1");
    const askTool = createToolEntry("tool-ask", "AskUserQuestion");
    const exitPlanTool = createToolEntry("tool-exit", "ExitPlanMode");
    const finalAnswer = createAssistantEntry("asst-final", {
      text: "Plan confirmed.",
    });

    const entries: CockpitTranscriptEntry[] = [
      prompt,
      hiddenTool,
      boundary,
      askTool,
      exitPlanTool,
      finalAnswer,
    ];

    const result = foldCockpitTurns(entries, {
      expandedFoldKeys: new Set(),
      latestTurnOpen: false,
    });

    expect(result).toEqual([
      prompt,
      {
        kind: "fold",
        key: "user-1\0fold",
        expanded: false,
        steps: 1,
        notes: 0,
      },
      boundary,
      askTool,
      exitPlanTool,
      finalAnswer,
    ]);
  });

  it("yields no fold row for a turn with nothing to hide", () => {
    const prompt = createUserEntry("user-1");
    const plainFinalAnswer = createAssistantEntry("asst-1", {
      text: "Plain answer with no tools or thinking.",
    });
    const entries: CockpitTranscriptEntry[] = [prompt, plainFinalAnswer];

    const result = foldCockpitTurns(entries, {
      expandedFoldKeys: new Set(),
      latestTurnOpen: false,
    });

    expect(result).toEqual([prompt, plainFinalAnswer]);
    expect(result.some((entry) => entry.kind === "fold")).toBe(false);
  });

  it("folds a leading body without a user prompt using a key based on its first entry", () => {
    const firstTool = createToolEntry("tool-head", "Bash");
    const interimNote = createAssistantEntry("asst-interim", {
      text: "Working through paginated history...",
    });
    const finalAnswer = createAssistantEntry("asst-final", {
      text: "Finished pagination.",
    });

    const entries: CockpitTranscriptEntry[] = [
      firstTool,
      interimNote,
      finalAnswer,
    ];

    const collapsedResult = foldCockpitTurns(entries, {
      expandedFoldKeys: new Set(),
      latestTurnOpen: false,
    });

    expect(collapsedResult).toEqual([
      {
        kind: "fold",
        key: "tool-head\0fold",
        expanded: false,
        steps: 1,
        notes: 1,
      },
      finalAnswer,
    ]);

    const expandedResult = foldCockpitTurns(entries, {
      expandedFoldKeys: new Set(["tool-head\0fold"]),
      latestTurnOpen: false,
    });

    expect(expandedResult).toEqual([
      {
        kind: "fold",
        key: "tool-head\0fold",
        expanded: true,
        steps: 1,
        notes: 1,
      },
      firstTool,
      interimNote,
      finalAnswer,
    ]);
  });

  it("does not mutate the input array", () => {
    const prompt = createUserEntry("user-1");
    const tool = createToolEntry("tool-1");
    const interimNote = createAssistantEntry("asst-note", { text: "Note" });
    const finalAnswer = createAssistantEntry("asst-final", {
      text: "Done",
      thinking: "Thought",
    });

    const entries: CockpitTranscriptEntry[] = [
      prompt,
      tool,
      interimNote,
      finalAnswer,
    ];
    const snapshot = [...entries];
    Object.freeze(entries);

    expect(() => {
      foldCockpitTurns(entries, {
        expandedFoldKeys: new Set(),
        latestTurnOpen: false,
      });
    }).not.toThrow();

    expect(entries).toEqual(snapshot);
    expect(entries[0]).toBe(prompt);
    expect(entries[1]).toBe(tool);
    expect(entries[2]).toBe(interimNote);
    expect(entries[3]).toBe(finalAnswer);
  });
});
