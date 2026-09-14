import { z } from "zod";
import { AssistantMessageSchema } from "../message/AssistantMessageSchema.js";
import { BaseEntrySchema } from "./BaseEntrySchema.js";

export const AssistantEntrySchema = BaseEntrySchema.extend({
  // discriminator
  type: z.literal("assistant"),

  // required
  message: AssistantMessageSchema,

  // optional
  requestId: z.string().optional(),
  isApiErrorMessage: z.boolean().optional(),
  /**
   * Claude Code stamps this when it aborts the in-flight API request and
   * persists whatever text had streamed so far — the transcript's own,
   * non-heuristic record that a `priority: "now"` steer cut the turn. Such a
   * record also has `stop_reason: null`, but the converse does not hold: null
   * `stop_reason` alone appears on other partial records too.
   */
  isAbortedMidStream: z.boolean().optional(),
});

export type AssistantEntry = z.infer<typeof AssistantEntrySchema>;
