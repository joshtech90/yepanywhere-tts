// @vitest-environment node
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import {
  readComposerHistory,
  rememberComposerPrompt,
  rememberComposerUpload,
} from "../composerHistory";

it("keeps concurrent prompt saves, deduplicates, bounds history and isolates accounts", async () => {
  const scope = crypto.randomUUID();
  await Promise.all(
    Array.from({ length: 55 }, (_, index) =>
      rememberComposerPrompt(scope, `prompt ${index}`),
    ),
  );
  await rememberComposerPrompt(scope, "prompt 20");
  const history = await readComposerHistory(scope);
  expect(history.prompts).toHaveLength(50);
  expect(history.prompts[0]?.text).toBe("prompt 20");
  expect(
    history.prompts.filter((item) => item.text === "prompt 20"),
  ).toHaveLength(1);
  expect((await readComposerHistory(`${scope}:other`)).prompts).toEqual([]);
});

it("keeps reusable upload bytes within one account and deduplicates identical bytes", async () => {
  const scope = crypto.randomUUID();
  const file = new File(["a private note"], "note.txt", { type: "text/plain" });
  await rememberComposerUpload(scope, file);
  await rememberComposerUpload(scope, file);
  const history = await readComposerHistory(scope);
  expect(history.uploads).toHaveLength(1);
  expect(await history.uploads[0]?.file.text()).toBe("a private note");
  expect((await readComposerHistory(`${scope}:other`)).uploads).toEqual([]);
});
