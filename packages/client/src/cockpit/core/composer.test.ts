import { beforeEach, describe, expect, it } from "vitest";
import {
  cockpitComposerDraftKey,
  createCockpitSubmissionMetadata,
  deriveCockpitComposerActions,
  frequentCockpitPrompts,
  readCockpitComposerDraft,
  readCockpitComposerSessionDraft,
  readCockpitPromptHistory,
  removeCockpitPromptHistorySource,
  rememberCockpitPrompt,
  writeCockpitComposerDraft,
} from "./composer";

beforeEach(() => localStorage.clear());

describe("Cockpit composer core", () => {
  it("chooses direct, steering, and honest queue fallbacks", () => {
    expect(
      deriveCockpitComposerActions({
        processState: "idle",
        supportsSteering: true,
      }).primary,
    ).toBe("send");
    expect(
      deriveCockpitComposerActions({
        processState: "in-turn",
        supportsSteering: true,
      }).primary,
    ).toBe("steer");
    expect(
      deriveCockpitComposerActions({
        processState: "waiting-input",
        supportsSteering: false,
      }).primary,
    ).toBe("queue");
  });

  it("keeps delivery intent and composition evidence explicit", () => {
    expect(
      createCockpitSubmissionMetadata({
        action: "steer",
        typingStartedAt: "2026-09-24T10:00:00.000Z",
        lastEditedAt: "2026-09-24T10:00:02.000Z",
        submittedAt: "2026-09-24T10:00:03.000Z",
      }),
    ).toEqual({
      deliveryIntent: "steer",
      composition: {
        typingStartedAt: "2026-09-24T10:00:00.000Z",
        typingEndedAt: "2026-09-24T10:00:03.000Z",
        lastEditedAt: "2026-09-24T10:00:02.000Z",
        submittedAt: "2026-09-24T10:00:03.000Z",
      },
    });
  });

  it("persists a source-, project-, and session-bound local draft", () => {
    const key = cockpitComposerDraftKey(
      "relay:studio",
      "project-1",
      "session-1",
    );
    writeCockpitComposerDraft(key, "Keep this prompt");
    expect(readCockpitComposerDraft(key)).toBe("Keep this prompt");
    writeCockpitComposerDraft(key, "");
    expect(readCockpitComposerDraft(key)).toBe("");

    expect(
      cockpitComposerDraftKey("relay:studio", "project-1", "session-1"),
    ).not.toBe(
      cockpitComposerDraftKey("relay:studio", "project-2", "session-1"),
    );
    expect(
      cockpitComposerDraftKey("relay:studio", "project-1", "session-1"),
    ).not.toBe(
      cockpitComposerDraftKey("relay:studio", "project-1", "session-2"),
    );
  });

  it("moves a legacy draft into the first project-bound key", () => {
    localStorage.setItem(
      "yep-anywhere-cockpit-composer:v1:relay:studio:session-legacy",
      "Keep the existing draft",
    );

    expect(
      readCockpitComposerSessionDraft(
        "relay:studio",
        "project-1",
        "session-legacy",
      ),
    ).toBe("Keep the existing draft");
    expect(
      readCockpitComposerDraft(
        cockpitComposerDraftKey(
          "relay:studio",
          "project-1",
          "session-legacy",
        ),
      ),
    ).toBe("Keep the existing draft");
    expect(
      localStorage.getItem(
        "yep-anywhere-cockpit-composer:v1:relay:studio:session-legacy",
      ),
    ).toBeNull();
  });

  it("keeps a bounded, source-local prompt-history seam for package 9", () => {
    rememberCockpitPrompt(
      "relay:studio",
      "  Summarize the fictional notes.  ",
      "2026-09-24T10:00:00.000Z",
    );
    rememberCockpitPrompt(
      "relay:studio",
      "Summarize the fictional notes.",
      "2026-09-24T10:01:00.000Z",
    );
    expect(readCockpitPromptHistory("relay:studio")).toEqual([
      {
        text: "Summarize the fictional notes.",
        usedAt: "2026-09-24T10:01:00.000Z",
        useCount: 2,
      },
    ]);
    expect(readCockpitPromptHistory("local")).toEqual([]);
  });

  it("migrates version-one history and ignores unknown versions", () => {
    localStorage.setItem(
      "yep-anywhere-cockpit-prompts",
      JSON.stringify({
        version: 1,
        sources: {
          local: [
            {
              text: "Review the fictional outline.",
              usedAt: "2026-09-24T09:00:00.000Z",
            },
          ],
        },
      }),
    );
    expect(readCockpitPromptHistory("local")[0]).toEqual({
      text: "Review the fictional outline.",
      usedAt: "2026-09-24T09:00:00.000Z",
      useCount: 1,
    });

    localStorage.setItem(
      "yep-anywhere-cockpit-prompts",
      JSON.stringify({ version: 77, sources: { local: [] } }),
    );
    expect(readCockpitPromptHistory("local")).toEqual([]);
  });

  it("ranks frequent prompts and removes only the selected host", () => {
    rememberCockpitPrompt("host:alpha", "Draft a fictional summary.");
    rememberCockpitPrompt("host:alpha", "Draft a fictional summary.");
    rememberCockpitPrompt("host:beta", "List fictional risks.");

    expect(frequentCockpitPrompts(readCockpitPromptHistory("host:alpha"))).toEqual(
      [
        expect.objectContaining({
          text: "Draft a fictional summary.",
          useCount: 2,
        }),
      ],
    );

    removeCockpitPromptHistorySource("host:alpha");
    expect(readCockpitPromptHistory("host:alpha")).toEqual([]);
    expect(readCockpitPromptHistory("host:beta")).toHaveLength(1);
  });
});
