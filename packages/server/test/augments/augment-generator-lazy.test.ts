import { createHighlighter } from "shiki";
import { expect, it, vi } from "vitest";
import { createAugmentGenerator } from "../../src/augments/augment-generator.js";

vi.mock("shiki", async (importOriginal) => {
  const actual = await importOriginal<typeof import("shiki")>();
  return { ...actual, createHighlighter: vi.fn(actual.createHighlighter) };
});

it("renders prose and pending code without Shiki, then shares finalized-code initialization", async () => {
  const generator = await createAugmentGenerator({ languages: ["typescript"] });
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
  expect(createHighlighter).not.toHaveBeenCalled();

  const block = {
    type: "code" as const,
    content: "```typescript\nconst value = 1;\n```",
    lang: "typescript",
    startOffset: 0,
    endOffset: 34,
  };
  const finalized = await Promise.all([
    generator.processBlock(block, 1),
    generator.processBlock(block, 2),
  ]);
  expect(createHighlighter).toHaveBeenCalledTimes(1);
  for (const augment of finalized) {
    expect(augment.html).toContain("<span");
    expect(augment.html).toContain('class="language-typescript"');
  }
});
