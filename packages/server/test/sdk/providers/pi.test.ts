import { afterEach, describe, expect, it } from "vitest";
import {
  PiProvider,
  loweredEffortForRejection,
  piVersionUsesAgentSettled,
} from "../../../src/sdk/providers/pi.js";

type PiEvent = { type: string; [key: string]: unknown };

const originalPiExecutable = process.env.PI_EXECUTABLE;

afterEach(() => {
  if (originalPiExecutable === undefined) {
    delete process.env.PI_EXECUTABLE;
  } else {
    process.env.PI_EXECUTABLE = originalPiExecutable;
  }
});

function makeStream(terminalEvent: "agent_end" | "agent_settled") {
  return {
    currentAssistantId: null,
    text: "",
    thinking: "",
    lastUsage: null,
    lastCostUsd: null,
    terminalEvent,
    turnError: null,
    toolStates: new Map(),
  };
}

function mapPiEvent(
  provider: PiProvider,
  event: PiEvent,
  sessionId: string,
  stream: ReturnType<typeof makeStream>,
) {
  const privateProvider = provider as unknown as {
    mapEvent(
      event: PiEvent,
      sessionId: string,
      stream: ReturnType<typeof makeStream>,
    ): unknown[];
  };
  return privateProvider.mapEvent(event, sessionId, stream);
}

describe("PiProvider event mapping", () => {
  it("keeps an unlaunchable explicit path authoritative", async () => {
    process.env.PI_EXECUTABLE = `${process.execPath}.missing-pi`;
    const provider = new PiProvider({ piPath: process.execPath });

    await expect(provider.isInstalled()).resolves.toBe(false);
  });

  it("selects the terminal event from the Pi version boundary", () => {
    expect(piVersionUsesAgentSettled("0.80.3")).toBe(false);
    expect(piVersionUsesAgentSettled("pi 0.80.4")).toBe(true);
    expect(piVersionUsesAgentSettled("0.81.1")).toBe(true);
    expect(piVersionUsesAgentSettled("unknown")).toBeNull();
  });

  it("waits for agent_settled before completing a YA turn", () => {
    const provider = new PiProvider();
    const stream = makeStream("agent_settled");
    const mapEvent = (event: PiEvent) =>
      mapPiEvent(provider, event, "pi-session", stream);

    expect(
      mapEvent({
        type: "turn_end",
        message: {
          usage: {
            input: 11,
            output: 7,
            cacheRead: 5,
            cacheWrite: 3,
            cost: { total: 0.012 },
          },
        },
      }),
    ).toEqual([]);

    expect(
      mapEvent({
        type: "agent_end",
        messages: [],
        willRetry: false,
      }),
    ).toEqual([]);

    expect(mapEvent({ type: "agent_settled" })).toEqual([
      {
        type: "result",
        session_id: "pi-session",
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 3,
        },
        total_cost_usd: 0.012,
      },
    ]);
  });

  it("keeps agent_end as the legacy pre-0.80.4 boundary", () => {
    const provider = new PiProvider();
    const stream = makeStream("agent_end");
    const mapEvent = (event: PiEvent) =>
      mapPiEvent(provider, event, "legacy-pi-session", stream);

    expect(mapEvent({ type: "agent_settled" })).toEqual([]);
    expect(mapEvent({ type: "agent_end", willRetry: false })).toEqual([
      {
        type: "result",
        session_id: "legacy-pi-session",
      },
    ]);
  });
});

describe("thinking level a rejected pi turn retries at", () => {
  // Captured from pi 0.85.1 driving vLLM 0.29 with reasoning_effort "high":
  // the failure arrives as an assistant message_end, not as an event of its
  // own, and the server names the whole set it does accept.
  const VLLM_REFUSAL =
    '400: {"message":"Unexpected reasoning effort high. Supported types are ' +
    'xhigh (default), medium, and low.","type":"BadRequestError",' +
    '"param":null,"code":400}';

  it("takes the highest accepted level at or below the one refused", () => {
    expect(loweredEffortForRejection(VLLM_REFUSAL, "high")).toBe("medium");
    expect(loweredEffortForRejection(VLLM_REFUSAL, "max")).toBe("xhigh");
  });

  it("steps down one level when the server only says the level is wrong", () => {
    expect(
      loweredEffortForRejection("unsupported reasoning_effort", "high"),
    ).toBe("medium");
    // Nothing below the lowest level, so there is no retry to make.
    expect(
      loweredEffortForRejection("unsupported reasoning_effort", "low"),
    ).toBeUndefined();
  });

  it("leaves an unrelated failure alone", () => {
    expect(
      loweredEffortForRejection("context length exceeded", "high"),
    ).toBeUndefined();
    // A level the server does accept is not a reason to lower anything.
    expect(loweredEffortForRejection(VLLM_REFUSAL, "medium")).toBeUndefined();
    expect(loweredEffortForRejection(VLLM_REFUSAL, undefined)).toBeUndefined();
  });
});

describe("PiProvider turn failure reporting", () => {
  it("carries pi's error message into the turn result", () => {
    const provider = new PiProvider();
    const stream = makeStream("agent_settled");
    const mapEvent = (event: PiEvent) =>
      mapPiEvent(provider, event, "pi-session", stream);

    expect(
      mapEvent({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "400: nope",
        },
      }),
    ).toEqual([]);
    expect(mapEvent({ type: "agent_settled" })).toEqual([
      expect.objectContaining({ type: "result", error: "400: nope" }),
    ]);
    // The next turn starts clean rather than reporting the last one's failure.
    expect(mapEvent({ type: "agent_settled" })).toEqual([
      expect.not.objectContaining({ error: expect.anything() }),
    ]);
  });
});
