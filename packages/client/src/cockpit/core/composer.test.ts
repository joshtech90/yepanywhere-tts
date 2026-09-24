import { beforeEach, describe, expect, it } from "vitest";
import {
  cockpitComposerDraftKey,
  createCockpitSubmissionMetadata,
  deriveCockpitComposerActions,
  readCockpitComposerDraft,
  readCockpitPromptHistory,
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

  it("persists a source- and session-bound local draft", () => {
    const key = cockpitComposerDraftKey("relay:studio", "session-1");
    writeCockpitComposerDraft(key, "Keep this prompt");
    expect(readCockpitComposerDraft(key)).toBe("Keep this prompt");
    writeCockpitComposerDraft(key, "");
    expect(readCockpitComposerDraft(key)).toBe("");
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
      },
    ]);
    expect(readCockpitPromptHistory("local")).toEqual([]);
  });
});
