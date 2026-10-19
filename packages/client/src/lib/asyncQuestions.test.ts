import { describe, expect, it } from "vitest";
import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import {
  collectAsyncQuestions,
  getQuestionReminderStage,
} from "./asyncQuestions";

describe("async question reminders", () => {
  it("counts questions separately and ages them by subsequent user prompts", () => {
    const items: RenderItem[] = [
      {
        type: "text",
        sourceBlockIndex: 0,
        id: "question-text",
        text: "Choose a color",
        sourceMessages: [
          {
            type: "assistant",
            uuid: "question-message",
            codexAgentMessageDelivery: "async",
            codexAsyncQuestions: [
              { title: "Choose a color", options: ["Blue", "Green"] },
              { title: "Anything else?", options: null },
            ],
          },
        ],
      },
      {
        type: "user_prompt",
        id: "reply",
        content: "Continue the work",
        sourceMessages: [],
      },
      {
        type: "text",
        sourceBlockIndex: 0,
        id: "ordinary",
        text: "Another update",
        sourceMessages: [],
      },
    ];
    const questions = collectAsyncQuestions(items);
    expect(
      questions.map(({ title, age, renderId }) => ({ title, age, renderId })),
    ).toEqual([
      { title: "Choose a color", age: 1, renderId: "question-text" },
      { title: "Anything else?", age: 1, renderId: "question-text" },
    ]);
    expect(collectAsyncQuestions([items[0]!, ...items])).toHaveLength(2);
  });

  it("recovers a sent quote reply without saved browser records", () => {
    const question: RenderItem = {
      type: "text",
      sourceBlockIndex: 0,
      id: "question",
      text: "First line\nSecond line?",
      sourceMessages: [
        {
          type: "assistant",
          uuid: "source",
          codexAgentMessageDelivery: "async",
          codexAsyncQuestions: [
            { title: "First line\nSecond line?", options: null },
          ],
        },
      ],
    };
    const reply: RenderItem = {
      type: "user_prompt",
      id: "reply",
      content: "> First line\n> Second line?\n\nUse the new defaults.",
      sourceMessages: [],
    };
    expect(collectAsyncQuestions([question, reply])[0]).toMatchObject({
      answer: "Use the new defaults.",
    });
    expect(
      collectAsyncQuestions([
        question,
        {
          ...reply,
          content: [{ type: "text", text: reply.content as string }],
        },
      ])[0],
    ).toMatchObject({ answer: "Use the new defaults." });
    expect(collectAsyncQuestions([reply, question])[0]).not.toHaveProperty(
      "answer",
    );
    for (const content of [
      "Continue",
      "> First line\n\nYes",
      "> First line\n> Second line?",
    ])
      expect(
        collectAsyncQuestions([question, { ...reply, content }])[0],
      ).not.toHaveProperty("answer");
    const repeated = {
      ...question,
      id: "repeated",
      sourceMessages: [
        {
          ...question.sourceMessages[0]!,
          uuid: "repeated-source",
        },
      ],
    };
    expect(
      collectAsyncQuestions([question, repeated, reply]).map((q) => q.answer),
    ).toEqual([undefined, "Use the new defaults."]);
    const later = Array.from(
      { length: 32 },
      (_, index): RenderItem => ({
        type: "user_prompt",
        id: `later-${index}`,
        content: "Continue",
        sourceMessages: [],
      }),
    );
    expect(
      collectAsyncQuestions([question, reply, ...later])[0],
    ).not.toHaveProperty("answer");
  });

  it("ages visibility in two stages without treating typing as an answer", () => {
    expect(getQuestionReminderStage(0, 0)).toBe("recent");
    expect(getQuestionReminderStage(3, 0)).toBe("quiet");
    expect(getQuestionReminderStage(0, 160)).toBe("quiet");
    expect(getQuestionReminderStage(8, 0)).toBe("retired");
    expect(getQuestionReminderStage(0, 600)).toBe("retired");
  });
});
