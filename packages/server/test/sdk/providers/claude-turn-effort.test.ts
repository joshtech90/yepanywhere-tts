import { describe, expect, it, vi } from "vitest";
import { MessageQueue } from "../../../src/sdk/messageQueue.js";
import { ClaudeTurnEffort } from "../../../src/sdk/providers/claude-turn-effort.js";

describe("Claude turn effort at provider input", () => {
  it("retains the override through steers and restores the latest normal setting", async () => {
    const query = {
      setMaxThinkingTokens: vi.fn(async () => {}),
      applyFlagSettings: vi.fn(async () => {}),
    };
    const controller = new ClaudeTurnEffort(
      () => query,
      async () => ({
        id: "opus",
        name: "Opus",
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        defaultEffortLevel: "high",
      }),
      { type: "adaptive" },
      "high",
    );
    const queue = new MessageQueue();
    const input = controller.input(queue)[Symbol.asyncIterator]();
    queue.push({ text: "careful", metadata: { turnEffort: "slow" } });
    expect((await input.next()).value).not.toHaveProperty("turnEffort");
    expect(query.applyFlagSettings.mock.calls).toEqual([
      [{ effortLevel: "xhigh" }],
    ]);
    queue.push({ text: "a steer", metadata: { deliveryIntent: "steer" } });
    await input.next();
    await controller.setEffort("medium");
    expect(query.applyFlagSettings).toHaveBeenCalledTimes(1);
    await controller.complete();
    expect(query.applyFlagSettings.mock.calls).toEqual([
      [{ effortLevel: "xhigh" }],
      [{ effortLevel: "medium" }],
    ]);
    queue.push({ text: "ordinary queued turn" });
    await input.next();
    expect(query.applyFlagSettings).toHaveBeenCalledTimes(2);
    await input.return?.();
  });

  it("disables thinking only for fastest and restores it before further delivery", async () => {
    const query = {
      setMaxThinkingTokens: vi.fn(async () => {}),
      applyFlagSettings: vi.fn(async () => {}),
    };
    const controller = new ClaudeTurnEffort(
      () => query,
      async () => ({ id: "opus", name: "Opus" }),
      { type: "adaptive", display: "summarized" },
      "high",
    );
    const queue = new MessageQueue();
    const input = controller.input(queue)[Symbol.asyncIterator]();
    queue.push({ text: "brief", metadata: { turnEffort: "fastest" } });
    await input.next();
    expect(query.setMaxThinkingTokens).toHaveBeenLastCalledWith(0, null);
    await controller.complete();
    expect(query.setMaxThinkingTokens).toHaveBeenLastCalledWith(
      1,
      "summarized",
    );
    expect(query.applyFlagSettings).toHaveBeenLastCalledWith({
      effortLevel: "high",
    });
    await input.return?.();
  });
});
