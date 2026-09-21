/**
 * Asking an OpenAI-compatible endpoint which thinking efforts it accepts.
 *
 * A vLLM `/v1/models` row carries an id, an owner and a window, so a model that
 * accepts reasoning effort looks exactly like one that does not, and the only
 * way to find out from configuration alone is to be told. The endpoint will
 * however state its own vocabulary if asked wrongly: a chat request naming an
 * effort the server does not recognize is rejected by request validation, and
 * the rejection lists every value the field accepts.
 *
 * Observed against vLLM 0.11 serving DeepSeek-V4-Flash:
 *
 *     POST /v1/chat/completions  {"reasoning_effort": "<unrecognized>", …}
 *     400  {"error":{"message":"1 validation error:\n  {'type':
 *          'literal_error', 'loc': 'body.reasoning_effort', 'msg': \"Input
 *          should be 'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or
 *          'max'\", …}"}}
 *
 * Validation runs before scheduling, so the probe costs no inference and no
 * accelerator time. What it reports is what the *endpoint* accepts, which for a
 * vLLM-style server is a property of its request schema rather than of the
 * model behind it: a server hosting a model that ignores the field still answers
 * with the full vocabulary. That is why a probe result ranks below both the
 * service's own configuration and a per-model catalog row — see
 * `gatewayModelEffort`.
 */

import { EFFORT_LEVEL_ORDER } from "./turn-effort.js";
import type { EffortLevel } from "./types.js";

/**
 * The effort value sent to provoke the endpoint's own list.
 *
 * Deliberately not a plausible level name: it has to fail validation on any
 * server that validates at all, and it should be recognizable in a log.
 */
export const GATEWAY_EFFORT_PROBE_VALUE = "ya-capability-probe";

/** What one endpoint said about the efforts it accepts. */
export interface GatewayEndpointEffortProbe {
  /** Levels YA has a name for, ascending. Empty means none were listed. */
  levels: EffortLevel[];
  /**
   * The endpoint accepts `"none"`, so thinking can be turned off rather than
   * only turned down. Carried separately because "none" is not one of YA's
   * effort levels: it is the absence of effort, which only some transports can
   * express.
   */
  noThinking: boolean;
  /**
   * The level the endpoint applies to a request naming none, when it said so.
   *
   * Only the chat-template stage states this; request-schema validation lists
   * accepted literals without naming a default.
   */
  defaultLevel?: EffortLevel;
}

/**
 * Every value the endpoint named, as written.
 *
 * The rejection quotes each accepted value, so the accepted set is the quoted
 * tokens. Both quote styles are read because the observed body nests a Python
 * repr inside a JSON string, which puts single quotes around the values and
 * double quotes around the sentence holding them.
 */
function quotedTokens(body: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of body.matchAll(/['"]([a-z][a-z0-9_-]{1,31})['"]/giu)) {
    tokens.add(match[1]!.toLowerCase());
  }
  return tokens;
}

/**
 * Read an endpoint's rejection of the probe value.
 *
 * Returns undefined when the body is not a statement about reasoning effort —
 * a server that rejected the request for some other reason, or accepted the
 * unrecognized value and so validates nothing, has told us nothing about which
 * efforts it accepts, and must not be read as having listed none.
 */
export function parseGatewayEffortProbe(
  body: string,
): GatewayEndpointEffortProbe | undefined {
  if (!/effort/iu.test(body)) return undefined;
  const tokens = quotedTokens(body);
  const levels = EFFORT_LEVEL_ORDER.filter((level) => tokens.has(level));
  if (levels.length === 0) return undefined;
  return { levels, noThinking: tokens.has("none") };
}

/**
 * Read a chat template's rejection of an effort its request schema accepts.
 *
 * Request validation and the chat template are two different gatekeepers, and
 * only the first is what `parseGatewayEffortProbe` reads. Observed against the
 * same vLLM serving Qwen3.8-Flash-Next, whose schema accepts all seven
 * literals:
 *
 *     POST /v1/chat/completions  {"reasoning_effort": "high", …}
 *     400  {"error":{"message":"Unexpected reasoning effort high. Supported
 *          types are xhigh (default), medium, and low.", …}}
 *
 * The rejection states the set the model actually distinguishes and marks the
 * one applied to a request naming none, so it answers both questions the
 * schema stage leaves open. Returns undefined for a body that is not such a
 * rejection — including a rejection for some unrelated reason, which says
 * nothing about the accepted set and must not be read as listing none.
 */
export function parseGatewayTemplateEffortRejection(
  body: string,
): GatewayEndpointEffortProbe | undefined {
  const supported = /supported\s+(?:types|values|efforts)\s+are\s+([^.]*)/iu
    .exec(body)
    ?.at(1);
  if (!supported || !/effort/iu.test(body)) return undefined;
  const named = new Set<string>();
  let defaultLevel: EffortLevel | undefined;
  let sawNone = false;
  // Each item is a bare word optionally trailed by "(default)"; the separators
  // are commas and a final "and", neither of which can be a level name.
  for (const match of supported.matchAll(
    /([a-z][a-z0-9_-]{1,31})\s*(\(default\))?/giu,
  )) {
    const word = match[1]!.toLowerCase();
    if (word === "and" || word === "or") continue;
    if (word === "none") {
      sawNone = true;
      continue;
    }
    if (!EFFORT_LEVEL_ORDER.includes(word as EffortLevel)) continue;
    named.add(word);
    if (match[2]) defaultLevel = word as EffortLevel;
  }
  const levels = EFFORT_LEVEL_ORDER.filter((level) => named.has(level));
  if (levels.length === 0) return undefined;
  return {
    levels,
    noThinking: sawNone,
    ...(defaultLevel ? { defaultLevel } : {}),
  };
}

/**
 * The request body that asks the chat template about one real effort value.
 *
 * Unlike the schema stage this names a level the endpoint's validation accepts,
 * so a template that also accepts it runs a one-token completion instead of
 * failing. That is the cost of the second stage, and the reason it is asked
 * with the highest level the schema listed: a template narrower than its
 * schema almost always narrows from the top, so the usual answer is another
 * free rejection.
 */
export function gatewayTemplateEffortProbeRequest(
  modelId: string,
  effort: EffortLevel,
): ReturnType<typeof gatewayEffortProbeRequest> {
  return { ...gatewayEffortProbeRequest(modelId), reasoning_effort: effort };
}

/**
 * Any model id the endpoint advertises, to fill the probe request's `model`.
 *
 * The probe asks about the endpoint's request schema, not about a model, but
 * the field is required and a server rejects an unknown one before it gets as
 * far as validating the effort. The first advertised id is therefore picked
 * purely for being known to be real.
 */
export function probeModelIdFromCatalog(payload: unknown): string | undefined {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return undefined;
  for (const row of rows) {
    const id = (row as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

/** The request body that provokes the list, kept to one token of output. */
export function gatewayEffortProbeRequest(modelId: string): {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
  stream: boolean;
  reasoning_effort: string;
} {
  return {
    model: modelId,
    // A server that validates the effort never reaches the model. One that
    // does not gets the smallest turn expressible rather than a real one.
    messages: [{ role: "user", content: "." }],
    max_tokens: 1,
    stream: false,
    reasoning_effort: GATEWAY_EFFORT_PROBE_VALUE,
  };
}
