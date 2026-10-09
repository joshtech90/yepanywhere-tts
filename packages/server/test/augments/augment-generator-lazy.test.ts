import { expect, it } from "vitest";
import { createAugmentGenerator } from "../../src/augments/augment-generator.js";
import { highlightWorker } from "../../src/highlighting/highlight-worker-host.js";

it("renders prose and pending code without the highlight worker, then shares it for finalized code", async () => {
  const generator = await createAugmentGenerator();
  const prose = await generator.processBlock(
    {
      type: "paragraph",
      content: "**Readable** prose",
      startOffset: 0,
      endOffset: 18,
    },
    0,
  );
  expect(prose.html).toContain("<strong>Readable</strong>");
  const pending = await generator.renderStreamingCodeBlock(
    {
      content: "```typescript\nconst value = 1;",
      lang: "typescript",
      startOffset: 0,
    },
    1,
  );
  expect(pending.html).toContain("const value = 1;");
  expect(highlightWorker.getStats().workersStarted).toBe(0);

  const block = {
    type: "code" as const,
    content: "```typescript\nconst value = 1;\n```",
    lang: "typescript",
    startOffset: 0,
    endOffset: 34,
  };
  const other = await createAugmentGenerator();
  const finalized = await Promise.all([
    generator.processBlock(block, 1),
    other.processBlock(block, 2),
  ]);
  expect(highlightWorker.getStats().workersStarted).toBe(1);
  for (const augment of finalized) {
    expect(augment.html).toContain("<span");
    expect(augment.html).toContain('class="language-typescript"');
  }
});
