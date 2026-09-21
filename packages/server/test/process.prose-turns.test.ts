import {
  capTurnText,
  MAX_POST_COMPACT_REPLAY_TURN_CHARS,
  POST_COMPACT_REPLAY_PREAMBLE,
} from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  Process,
  createControllableIterator,
  waitFor,
} from "./process.test-support.js";
import type { UrlProjectId } from "./process.test-support.js";

function startProcess() {
  const controller = createControllableIterator();
  const process = new Process(controller.iterator, {
    projectPath: "/test",
    projectId: "proj-1" as UrlProjectId,
    sessionId: "sess-1",
    provider: "claude",
    idleTimeoutMs: 100,
  });
  controller.push({
    type: "system",
    subtype: "init",
    session_id: "sess-1",
  });
  return { controller, process };
}

describe("Process", () => {
  describe("post-compact replay window", () => {
    it("caps a stored turn the way the replay selector caps it", async () => {
      const { controller, process } = startProcess();
      const long = "x".repeat(MAX_POST_COMPACT_REPLAY_TURN_CHARS + 500);

      controller.push({ type: "assistant", message: { content: long } });

      await waitFor(() =>
        expect(process.getRecentProseTurns()).toEqual([
          { role: "assistant", text: capTurnText(long) },
        ]),
      );
      expect(process.getRecentProseTurns()[0]?.text.length).toBeLessThan(
        long.length,
      );
      controller.finish();
      await process.abort();
    });

    it("keeps the echoed continuation out of the window", async () => {
      const { controller, process } = startProcess();

      controller.push({
        type: "user",
        message: { role: "user", content: "fix the parser" },
      });
      controller.push({
        type: "user",
        message: {
          role: "user",
          content: `${POST_COMPACT_REPLAY_PREAMBLE}\n> user: fix the parser\n\ncontinue.`,
        },
      });

      await waitFor(() =>
        expect(process.getRecentProseTurns()).toEqual([
          { role: "user", text: "fix the parser" },
        ]),
      );
      controller.finish();
      await process.abort();
    });
  });
});
