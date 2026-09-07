import { createHash } from "node:crypto";
import {
  formatConversationContextTurn,
  type ConversationContextRequest,
  type ConversationContextReceipt,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import type { Supervisor } from "../supervisor/Supervisor.js";

function isRequest(value: unknown): value is ConversationContextRequest {
  if (!value || typeof value !== "object") return false;
  const { requestId, turns } = value as Partial<ConversationContextRequest>;
  return (
    typeof requestId === "string" &&
    /^[\w-]{1,128}$/.test(requestId) &&
    Array.isArray(turns) &&
    turns.length > 0 &&
    turns.length <= 64 &&
    turns.every(
      (turn) =>
        turn &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.text === "string",
    ) &&
    turns.reduce((total, turn) => total + turn.text.length, 0) <= 262144
  );
}

export function createConversationContextRoutes(deps: {
  supervisor: Pick<Supervisor, "getProcessForSession">;
}): Hono {
  const routes = new Hono();
  const receipts = new WeakMap<
    object,
    Map<
      string,
      {
        payload: string;
        result: Promise<ConversationContextReceipt>;
      }
    >
  >();
  routes.post(
    "/:projectId/sessions/:sessionId/conversation-context",
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
      if (!isRequest(body))
        return c.json(
          {
            error:
              "Expected a request ID and a bounded sequence of user/assistant text turns",
          },
          400,
        );
      const process = deps.supervisor.getProcessForSession(
        c.req.param("sessionId"),
      );
      if (!process || process.projectId !== c.req.param("projectId")) {
        return c.json(
          {
            error: "Reactivate the session before sending conversation context",
          },
          409,
        );
      }
      let entries = receipts.get(process);
      if (!entries) {
        entries = new Map();
        receipts.set(process, entries);
      }
      const payload = createHash("sha256")
        .update(JSON.stringify(body.turns))
        .digest("hex");
      let entry = entries.get(body.requestId);
      if (entry && entry.payload !== payload)
        return c.json(
          { error: "Request ID was already used with different turns" },
          409,
        );
      if (!entry) {
        if (entries.size >= 256)
          return c.json(
            {
              error:
                "Conversation context receipt limit reached for this process",
            },
            429,
          );
        const request = body;
        entry = {
          payload,
          result: (async (): Promise<ConversationContextReceipt> => {
            if (await process.appendConversationContext(request.turns)) {
              return { delivery: "native-history" };
            }
            const result = process.queueMessage({
              text: formatConversationContextTurn(request.turns),
              uuid: request.requestId,
            });
            if (!result.success)
              throw new Error(
                result.error ?? "Context message was not accepted",
              );
            return { delivery: "user-turn" };
          })(),
        };
        entries.set(body.requestId, entry);
      }
      try {
        return c.json(await entry.result);
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Context delivery failed; acceptance may be uncertain",
          },
          502,
        );
      }
    },
  );
  return routes;
}
