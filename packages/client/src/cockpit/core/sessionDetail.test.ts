import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import { describe, expect, it } from "vitest";
import {
  createCockpitTranscriptEntries,
  deriveCockpitSessionState,
} from "./sessionDetail";

const initialItems: RenderItem[] = [
  {
    type: "user_prompt",
    id: "user-1",
    content: "Summarize the launch notes.",
    sourceMessages: [
      { uuid: "user-1", timestamp: "2026-09-24T09:00:00.000Z" },
    ],
  },
  {
    type: "thinking",
    id: "thinking-1",
    thinking: "I should separate confirmed facts from open questions.",
    status: "complete",
    sourceMessages: [
      { uuid: "assistant-1", timestamp: "2026-09-24T09:00:01.000Z" },
    ],
  },
  {
    type: "text",
    id: "text-1",
    text: "## Result\n\nThe checklist is ready.",
    augmentHtml: "<h2>Result</h2><p>The checklist is ready.</p>",
    sourceMessages: [
      { uuid: "assistant-1", timestamp: "2026-09-24T09:00:02.000Z" },
    ],
  },
  {
    type: "tool_call",
    id: "tool-1",
    toolName: "Bash",
    toolInput: { command: "printf 'DEMO_OK\\n'" },
    toolResult: {
      content: "DEMO_OK\n",
      isError: false,
      structured: { stdout: "DEMO_OK\n", stderr: "" },
    },
    status: "complete",
    sourceMessages: [
      { uuid: "assistant-1", timestamp: "2026-09-24T09:00:03.000Z" },
    ],
  },
];

describe("Cockpit session detail projection", () => {
  it("keeps warm-return rows stable and preserves rendered Markdown", () => {
    const first = createCockpitTranscriptEntries({
      sourceKey: "local",
      sessionId: "session-1",
      renderItems: initialItems,
    });
    const warmReturn = createCockpitTranscriptEntries({
      sourceKey: "local",
      sessionId: "session-1",
      renderItems: initialItems,
    });

    expect(warmReturn).toEqual(first);
    expect(warmReturn.map((entry) => entry.key)).toEqual(
      first.map((entry) => entry.key),
    );
    expect(warmReturn[1]).toMatchObject({
      kind: "assistant",
      spokenText: "## Result\n\nThe checklist is ready.",
      text: [
        {
          augmentHtml: "<h2>Result</h2><p>The checklist is ready.</p>",
        },
      ],
    });
    expect(warmReturn[2]).toMatchObject({
      kind: "tool",
      tool: {
        displayName: "Bash",
        kind: "shell",
        status: "complete",
      },
    });
  });

  it("appends catch-up content without changing earlier source-bound keys", () => {
    const before = createCockpitTranscriptEntries({
      sourceKey: "local",
      sessionId: "session-1",
      renderItems: initialItems,
    });
    const after = createCockpitTranscriptEntries({
      sourceKey: "local",
      sessionId: "session-1",
      renderItems: [
        ...initialItems,
        {
          type: "user_prompt",
          id: "user-2",
          content: [{ type: "text", text: "What remains open?" }],
          sourceMessages: [{ uuid: "user-2" }],
        },
        {
          type: "text",
          id: "text-2",
          text: "Only the mobile review remains.",
          sourceMessages: [{ uuid: "assistant-2" }],
        },
      ],
    });

    expect(after.slice(0, before.length).map((entry) => entry.key)).toEqual(
      before.map((entry) => entry.key),
    );
    expect(after.at(-1)).toMatchObject({
      kind: "assistant",
      spokenText: "Only the mobile review remains.",
    });
  });

  it("splits uploaded files off the prompt text", () => {
    const [entry] = createCockpitTranscriptEntries({
      sourceKey: "local",
      sessionId: "session-1",
      renderItems: [
        {
          type: "user_prompt",
          id: "user-files",
          content:
            "Which code word?\n\nUser uploaded files:\n- [notes.txt](</data/attachments/abc_notes.txt>) (35 b, text/plain)",
          sourceMessages: [{ uuid: "user-files" }],
        },
      ],
    });
    expect(entry).toMatchObject({
      kind: "user",
      text: "Which code word?",
      attachments: [{ name: "notes.txt" }],
    });
  });

  it("retains unchanged row objects when only a live tail is appended", () => {
    const before = createCockpitTranscriptEntries({
      sourceKey: "local",
      sessionId: "session-1",
      renderItems: initialItems,
    });
    const after = createCockpitTranscriptEntries({
      previousEntries: before,
      sourceKey: "local",
      sessionId: "session-1",
      renderItems: [
        ...initialItems,
        {
          type: "user_prompt",
          id: "user-tail",
          content: "Invented live tail",
          sourceMessages: [{ uuid: "user-tail" }],
        },
      ],
    });

    expect(after.slice(0, before.length)).toEqual(before);
    after.slice(0, before.length).forEach((entry, index) => {
      expect(entry).toBe(before[index]);
    });
  });

  it("isolates identical session ids when the active source changes", () => {
    const local = createCockpitTranscriptEntries({
      sourceKey: "local",
      sessionId: "shared-id",
      renderItems: initialItems,
    });
    const remote = createCockpitTranscriptEntries({
      sourceKey: "remote:studio",
      sessionId: "shared-id",
      renderItems: initialItems,
    });

    expect(remote.map((entry) => entry.key)).not.toEqual(
      local.map((entry) => entry.key),
    );
  });

  it("projects transport and live-session state without claiming authority", () => {
    const base = {
      transport: "empty" as const,
      loadError: false,
      owner: "self" as const,
      processState: "idle" as const,
      updatesConnected: true,
      updatesResubscribing: false,
    };

    expect(
      deriveCockpitSessionState({ ...base, processState: "in-turn" }),
    ).toBe("active");
    expect(
      deriveCockpitSessionState({ ...base, processState: "waiting-input" }),
    ).toBe("waiting");
    expect(
      deriveCockpitSessionState({ ...base, updatesResubscribing: true }),
    ).toBe("reconnecting");
    expect(deriveCockpitSessionState({ ...base, transport: "loading" })).toBe(
      "reconnecting",
    );
    expect(deriveCockpitSessionState({ ...base, transport: "offline" })).toBe(
      "offline",
    );
    expect(deriveCockpitSessionState({ ...base, loadError: true })).toBe(
      "error",
    );
  });

  it("shows work in another program instead of a finished session", () => {
    const external = {
      transport: "empty" as const,
      loadError: false,
      owner: "external" as const,
      processState: "idle" as const,
      updatesConnected: false,
      updatesResubscribing: false,
    };

    expect(
      deriveCockpitSessionState({ ...external, workingElsewhere: true }),
    ).toBe("external");
    expect(
      deriveCockpitSessionState({
        ...external,
        owner: "none",
        workingElsewhere: false,
      }),
    ).toBe("complete");
    expect(
      deriveCockpitSessionState({
        ...external,
        processState: "waiting-input",
        workingElsewhere: true,
      }),
    ).toBe("external");
    expect(
      deriveCockpitSessionState({
        ...external,
        transport: "offline",
        workingElsewhere: true,
      }),
    ).toBe("offline");
  });
});
