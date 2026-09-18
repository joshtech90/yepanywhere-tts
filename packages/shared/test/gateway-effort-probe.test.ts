import { describe, expect, it } from "vitest";
import {
  GATEWAY_EFFORT_PROBE_VALUE,
  gatewayEffortProbeRequest,
  parseGatewayEffortProbe,
  probeModelIdFromCatalog,
} from "../src/gateway-effort-probe.js";

/**
 * Captured verbatim from vLLM 0.11 serving DeepSeek-V4-Flash, in response to
 * exactly the request `gatewayEffortProbeRequest` builds. The nesting matters:
 * a Python repr lives inside a JSON string, so the accepted values are single
 * quoted while the sentence holding them is double quoted.
 */
const VLLM_REJECTION = JSON.stringify({
  error: {
    message:
      "1 validation error:\n  {'type': 'literal_error', 'loc': " +
      "'body.reasoning_effort', 'msg': \"Input should be 'none', 'minimal', " +
      "'low', 'medium', 'high', 'xhigh' or 'max'\", 'input': " +
      "'ya-capability-probe', 'ctx': {'expected': \"'none', 'minimal', 'low', " +
      "'medium', 'high', 'xhigh' or 'max'\"}}",
    type: "Bad Request",
    param: "body.reasoning_effort",
    code: 400,
  },
});

describe("parseGatewayEffortProbe", () => {
  it("reads the levels a vLLM endpoint lists, in ascending order", () => {
    expect(parseGatewayEffortProbe(VLLM_REJECTION)).toEqual({
      levels: ["low", "medium", "high", "xhigh", "max"],
      noThinking: true,
    });
  });

  it("drops values YA has no level for", () => {
    // "minimal" is accepted by the endpoint and named nowhere in YA's menu.
    expect(parseGatewayEffortProbe(VLLM_REJECTION)?.levels).not.toContain(
      "minimal",
    );
  });

  it("does not mistake the probe value itself for a level", () => {
    expect(parseGatewayEffortProbe(VLLM_REJECTION)?.levels).toEqual(
      expect.not.arrayContaining([GATEWAY_EFFORT_PROBE_VALUE]),
    );
  });

  it("reports no thinking-off for an endpoint that omits 'none'", () => {
    const body = JSON.stringify({
      error: { message: "reasoning_effort must be one of 'low', 'high'" },
    });
    expect(parseGatewayEffortProbe(body)).toEqual({
      levels: ["low", "high"],
      noThinking: false,
    });
  });

  it("says nothing about an error that is not about effort", () => {
    const body = JSON.stringify({
      error: { message: "model 'low' does not exist" },
    });
    expect(parseGatewayEffortProbe(body)).toBeUndefined();
  });

  it("says nothing when an effort error lists no level YA knows", () => {
    const body = JSON.stringify({
      error: { message: "reasoning_effort is not supported" },
    });
    expect(parseGatewayEffortProbe(body)).toBeUndefined();
  });
});

describe("gatewayEffortProbeRequest", () => {
  it("asks for one token, unstreamed, with an unrecognizable effort", () => {
    expect(gatewayEffortProbeRequest("deepseek-v4-flash")).toEqual({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "." }],
      max_tokens: 1,
      stream: false,
      reasoning_effort: GATEWAY_EFFORT_PROBE_VALUE,
    });
  });
});

describe("probeModelIdFromCatalog", () => {
  it("takes the first advertised id", () => {
    expect(
      probeModelIdFromCatalog({
        data: [{ id: " deepseek-v4-flash " }, { id: "other" }],
      }),
    ).toBe("deepseek-v4-flash");
  });

  it("skips rows with no usable id", () => {
    expect(
      probeModelIdFromCatalog({ data: [{ id: "" }, {}, { id: "real" }] }),
    ).toBe("real");
  });

  it("has nothing to ask about for an empty or malformed catalog", () => {
    expect(probeModelIdFromCatalog({ data: [] })).toBeUndefined();
    expect(probeModelIdFromCatalog({})).toBeUndefined();
    expect(probeModelIdFromCatalog(null)).toBeUndefined();
  });
});
