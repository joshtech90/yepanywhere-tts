import type { RendezDelivery } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import { createRendezSessions } from "../../src/services/rendezSessions.js";
import {
  MessageQueue,
  Process,
  type SDKMessage,
  type UrlProjectId,
} from "../process.test-support.js";

describe("createRendezSessions", () => {
  // Held to turn end while the user steers, uploads arrived after the
  // commentary about them, merged into one turn of every upload made
  // during a long turn, and showed as "sent" while they waited.
  it.each([
    { delivery: undefined, lastSend: undefined, steers: true },
    { delivery: "auto", lastSend: "steer", steers: true },
    { delivery: "auto", lastSend: "deferred", steers: false },
    { delivery: "steer", lastSend: "deferred", steers: true },
    { delivery: "queue", lastSend: "steer", steers: false },
  ] as const)(
    "delivers an upload during a turn as $delivery after a $lastSend send",
    async ({ delivery, lastSend, steers }) => {
      let resolveIterator!: (result: IteratorResult<SDKMessage>) => void;
      const iterator: AsyncIterator<SDKMessage> = {
        next: () =>
          new Promise((resolve) => {
            resolveIterator = resolve;
          }),
      };
      const steerFn = vi.fn(async (_message: { uuid?: string }) => true);
      let alive = true;
      const process = new Process(iterator, {
        projectPath: "/work/project",
        projectId: "proj-1" as UrlProjectId,
        sessionId: "receiver",
        provider: "codex",
        idleTimeoutMs: 1_000_000,
        queue: new MessageQueue(),
        steerFn,
        isProcessAlive: () => alive,
      });
      try {
        process.queueMessage({ text: "start the turn" });
        expect(process.state.type).toBe("in-turn");
        if (lastSend) {
          process.noteBusySendAction({
            text: "typed while busy",
            metadata: { origin: "user", deliveryIntent: lastSend },
          });
        }
        const route = await createRendezSessions(
          () => [process],
          (): RendezDelivery | undefined => delivery,
        ).route("/work/project", {
          harness: "codex",
          providerSessionId: "receiver",
          yaSessionId: "receiver",
        });
        const result = await route.send(
          "upload-1",
          "Please inspect the uploaded file.",
        );

        expect(result.accepted).toBe(true);
        const steered = steerFn.mock.calls.some(
          ([message]) => message.uuid === "upload-1",
        );
        expect(steered).toBe(steers);
        // A held upload is a visible queued chip, not a "sent" turn.
        expect(
          process.getDeferredQueueSummary().map((row) => row.tempId),
        ).toEqual(steers ? [] : ["upload-1"]);
      } finally {
        alive = false;
        resolveIterator({ done: true, value: undefined });
        await process.abort();
      }
    },
  );
});
