import { describe, expect, it, vi } from "vitest";
import {
  CockpitInputRejectedError,
  readCockpitPendingInput,
  respondToCockpitInput,
  type CockpitInputTransport,
} from "./inputRequest";

function transport(result: unknown): CockpitInputTransport {
  return {
    fetch: vi.fn(async () => result) as CockpitInputTransport["fetch"],
  };
}

describe("Cockpit pending-input transport", () => {
  it("posts a response through the selected source transport", async () => {
    const source = transport({ accepted: true, pendingInputRequest: null });

    await expect(
      respondToCockpitInput(
        source,
        "session/1",
        "request-1",
        "approve",
        { "Fictional choice": "Concise" },
      ),
    ).resolves.toBeNull();
    expect(source.fetch).toHaveBeenCalledWith("/sessions/session%2F1/input", {
      method: "POST",
      body: JSON.stringify({
        requestId: "request-1",
        response: "approve",
        answers: { "Fictional choice": "Concise" },
      }),
    });
  });

  it("does not claim success when the server declines the response", async () => {
    const source = transport({ accepted: false });

    await expect(
      respondToCockpitInput(source, "session-1", "request-1", "deny"),
    ).rejects.toBeInstanceOf(CockpitInputRejectedError);
  });

  it("reads the current request for stale-response reconciliation", async () => {
    const request = {
      id: "request-2",
      sessionId: "session-1",
      type: "tool-approval" as const,
      prompt: "Allow the fictional tool?",
      timestamp: "2026-09-25T01:00:00.000Z",
    };
    const source = transport({ request });

    await expect(
      readCockpitPendingInput(source, "session-1"),
    ).resolves.toEqual(request);
    expect(source.fetch).toHaveBeenCalledWith(
      "/sessions/session-1/pending-input",
    );
  });
});
