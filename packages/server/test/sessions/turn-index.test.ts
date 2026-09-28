import { describe, expect, it } from "vitest";
import {
  stampTurnIndexes,
  turnIndexOf,
} from "../../src/sessions/turn-index.js";
import type { Message } from "../../src/supervisor/types.js";

function user(
  uuid: string,
  content: unknown,
  extra: Record<string, unknown> = {},
): Message {
  return {
    type: "user",
    uuid,
    message: { role: "user", content },
    ...extra,
  } as unknown as Message;
}

function assistant(uuid: string): Message {
  return {
    type: "assistant",
    uuid,
    message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
  } as unknown as Message;
}

describe("stampTurnIndexes", () => {
  it("numbers only the turns the user authored", () => {
    const messages = stampTurnIndexes([
      user("u1", "first"),
      assistant("a1"),
      user("tool", [{ type: "tool_result", tool_use_id: "t1", content: "x" }]),
      user(
        "summary",
        "This session is being continued from a previous conversation that ran out of context.",
        { isCompactSummary: true },
      ),
      user("skill", "Base directory for this skill: /skills/review\n\nBody", {
        isMeta: true,
      }),
      user("synthetic", "resume", { isSynthetic: true }),
      user("u2", [{ type: "text", text: "second" }]),
      assistant("a2"),
    ]);

    const stamped = messages
      .map((message) => [message.uuid, turnIndexOf(message)])
      .filter(([, index]) => index !== undefined);
    expect(stamped).toEqual([
      ["u1", 1],
      ["u2", 2],
    ]);
  });

  it("keeps full-sequence ordinals for turns a rewind grouped", () => {
    const messages = stampTurnIndexes([
      user("u1", "first"),
      user("dropped", "second", { rewoundGroupId: "rw-1" }),
      user("u3", "third"),
    ]);

    expect(messages.map(turnIndexOf)).toEqual([1, 2, 3]);
  });
});
