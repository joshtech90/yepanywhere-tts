import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  resolveTurnEffort,
  thinkingOptionToConfig,
  type EffortLevel,
  type ModelInfo,
  type ThinkingConfig,
  type ThinkingOption,
} from "@yep-anywhere/shared";
import type { QueuedSDKUserMessage } from "../messageQueue.js";

export class ClaudeTurnEffort {
  private overridden = false;

  constructor(
    private readonly query: () => Pick<
      Query,
      "setMaxThinkingTokens" | "applyFlagSettings"
    >,
    private readonly model: () => Promise<ModelInfo>,
    private thinking?: ThinkingConfig,
    private effort?: EffortLevel,
  ) {}

  async *input(
    messages: AsyncIterable<QueuedSDKUserMessage>,
  ): AsyncIterable<SDKUserMessage> {
    for await (const message of messages) {
      const { turnEffort, ...providerMessage } = message;
      if (turnEffort) {
        if (this.overridden)
          throw new Error("An effort-modified turn is already active");
        const normal: ThinkingOption =
          this.thinking?.type === "disabled"
            ? "off"
            : this.effort
              ? `on:${this.effort}`
              : "auto";
        const selected = thinkingOptionToConfig(
          resolveTurnEffort(turnEffort, normal, await this.model()),
        );
        await this.apply(selected.thinking, selected.effort);
        this.overridden = true;
      }
      yield providerMessage;
    }
  }

  async complete(): Promise<void> {
    if (!this.overridden) return;
    await this.apply(this.thinking, this.effort);
    this.overridden = false;
  }

  async setEffort(effort?: EffortLevel): Promise<void> {
    if (!this.overridden)
      await this.query().applyFlagSettings({ effortLevel: effort ?? null });
    this.effort = effort;
  }

  async setThinking(tokens: number | null): Promise<void> {
    if (!this.overridden) await this.query().setMaxThinkingTokens(tokens);
    this.thinking =
      tokens === 0
        ? { type: "disabled" }
        : tokens === null
          ? undefined
          : { type: "adaptive", display: "summarized" };
  }

  private async apply(
    thinking?: ThinkingConfig,
    effort?: EffortLevel,
  ): Promise<void> {
    await this.query().setMaxThinkingTokens(
      thinking?.type === "disabled" ? 0 : thinking ? 1 : null,
      thinking?.type === "adaptive" ? (thinking.display ?? "summarized") : null,
    );
    await this.query().applyFlagSettings({ effortLevel: effort ?? null });
  }
}
