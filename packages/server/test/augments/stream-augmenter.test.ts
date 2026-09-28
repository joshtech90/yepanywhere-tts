import { describe, expect, it } from "vitest";
import {
  createStreamAugmenter,
  type MarkdownAugmentData,
  type PendingData,
} from "../../src/augments/stream-augmenter.js";

describe("assistant snapshot markdown", () => {
  it("renders cumulative snapshots once, including completion and the next message", async () => {
    const blocks: MarkdownAugmentData[] = [];
    const pending: PendingData[] = [];
    const augmenter = await createStreamAugmenter({
      onMarkdownAugment: (event) => blocks.push(event),
      onPending: (event) => pending.push(event),
    });
    const message = (uuid: string, text: string, streaming = true) => ({
      type: "assistant",
      uuid,
      _isStreaming: streaming,
      message: { role: "assistant", content: text },
    });
    for (const text of ["I’ll", "I’ll open", "I’ll open a Clair sketch."]) {
      await augmenter.processStreamingMessage(message("first", text));
    }
    expect(pending.at(-1)?.html).toBe("I’ll open a Clair sketch.");
    await augmenter.processStreamingMessage(
      message("first", "I’ll open a Clair sketch.", false),
    );
    expect(blocks).toEqual([
      expect.objectContaining({
        messageId: "first",
        blockIndex: 0,
        html: "<p>I’ll open a Clair sketch.</p>",
      }),
    ]);
    await augmenter.processStreamingMessage(
      message("second", "Next paragraph."),
    );
    expect(pending.at(-1)).toEqual({
      messageId: "second",
      html: "Next paragraph.",
    });
  });

  it("continues a late subscriber's snapshot without appending its prefix again", async () => {
    const pending: PendingData[] = [];
    const augmenter = await createStreamAugmenter({
      onMarkdownAugment: () => {},
      onPending: (event) => pending.push(event),
    });
    await augmenter.processCatchUp("I’ll open", "first");
    await augmenter.processStreamingMessage({
      type: "assistant",
      uuid: "first",
      _isStreaming: true,
      message: { content: "I’ll open a Clair sketch." },
    });
    expect(pending.at(-1)).toEqual({
      messageId: "first",
      html: "I’ll open a Clair sketch.",
    });
    augmenter.reset();
    await augmenter.processStreamingMessage({
      type: "assistant",
      uuid: "first",
      _isStreaming: true,
      message: { content: "Fresh" },
    });
    expect(pending.at(-1)?.html).toBe("Fresh");
  });
});
