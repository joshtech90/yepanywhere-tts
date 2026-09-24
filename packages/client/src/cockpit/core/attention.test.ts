import type { InputRequest } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  areCockpitQuestionsAnswered,
  createCockpitAttentionDisplay,
  createCockpitQuestionAnswers,
} from "./attention";

function request(overrides: Partial<InputRequest> = {}): InputRequest {
  return {
    id: "request-1",
    sessionId: "session-1",
    type: "tool-approval",
    prompt: "Allow the action?",
    timestamp: "2026-09-24T10:00:00.000Z",
    ...overrides,
  };
}

describe("Cockpit attention projection", () => {
  it("projects Codex-style choices and structured questions", () => {
    const display = createCockpitAttentionDisplay(
      request({
        type: "question",
        prompt: "Choose a scope",
        toolName: "AskUserQuestion",
        toolInput: {
          questions: [
            {
              id: "scope",
              header: "Scope",
              question: "Which scope should be checked?",
              isOther: false,
              options: [
                { label: "Current file", description: "Only this file" },
                { label: "Workspace", description: "All loaded files" },
              ],
            },
          ],
        },
      }),
    );

    expect(display).toMatchObject({
      kind: "question",
      questions: [
        {
          header: "Scope",
          key: "scope",
          options: [
            { label: "Current file", value: "Current file" },
            { label: "Workspace", value: "Workspace" },
          ],
          prompt: "Which scope should be checked?",
        },
      ],
    });
  });

  it("keeps unknown approval types visible without guessing provider behavior", () => {
    const display = createCockpitAttentionDisplay(
      request({
        type: "provider-confirmation" as InputRequest["type"],
        prompt: "Confirm provider-owned action",
        toolName: "future_tool",
        toolInput: { opaque: "<not markup>" },
      }),
    );

    expect(display).toMatchObject({
      kind: "approval",
      rawType: "provider-confirmation",
      toolName: "future_tool",
    });
    expect(display.inputPreview).toContain("<not markup>");
  });

  it("builds provider answer records only after every question is answered", () => {
    const display = createCockpitAttentionDisplay(
      request({
        type: "question",
        toolName: "AskUserQuestion",
        toolInput: {
          questions: [
            {
              id: "checks",
              header: "Checks",
              question: "Which checks?",
              multiSelect: true,
              options: ["Unit", "Types"],
            },
            {
              id: "note",
              header: "Note",
              question: "Anything else?",
              options: null,
            },
          ],
        },
      }),
    );
    const selections = { checks: ["Unit", "Types"] };

    expect(
      areCockpitQuestionsAnswered(display.questions, selections, {}),
    ).toBe(false);
    expect(
      areCockpitQuestionsAnswered(display.questions, selections, {
        note: "Use invented fixtures.",
      }),
    ).toBe(true);
    expect(
      createCockpitQuestionAnswers(display.questions, selections, {
        note: "Use invented fixtures.",
      }),
    ).toEqual({
      checks: ["Unit", "Types"],
      note: "Use invented fixtures.",
    });
  });
});
