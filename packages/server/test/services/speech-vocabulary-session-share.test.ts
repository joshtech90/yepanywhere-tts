import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { VocabularyStore } from "../../src/services/voice/VocabularyStore.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

const baseline = new Map<string, number>();

/**
 * A long global history and one small session. Every global term is counted
 * hundreds of times and every session term once, which is the case a fixed
 * multiplier cannot rescue: the global counts grow with history while the
 * session's do not.
 */
function fixture(
  sessionShare: number,
  sessionMultiplier: number,
  freshWeight = 1,
) {
  const dir = mkdtempSync(join(tmpdir(), "ya-vocabulary-share-"));
  const store = new VocabularyStore(dir);
  cleanup.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.configure({
    enabled: true,
    biasing: true,
    hours: 24,
    sessionShare,
    sessionMultiplier,
  });
  for (let index = 0; index < 40; index++)
    store.addWordCounts(`global${index}`, 400, 400);
  for (let index = 0; index < 40; index++)
    store.addWordCounts(`fresh${index}`, freshWeight, 0);
  for (let index = 0; index < 40; index++)
    store.observe(
      "live",
      { source: "user", timestamp: Date.now(), text: `fresh${index}` },
      store.settings().generation,
    );
  return store;
}

const freshCount = (terms: string[]) =>
  terms.filter((term) => term.startsWith("fresh")).length;

it("lets a long history crowd out a fresh session when nothing is reserved", () => {
  const store = fixture(0, 5);
  const selected = store.keyterms(baseline, 10, 50, new Set(), "live");
  expect(selected).toHaveLength(10);
  expect(freshCount(selected)).toBe(0);
});

it("holds the reserved share for the session and still fills the rest", () => {
  const store = fixture(0.3, 5);
  const selected = store.keyterms(baseline, 10, 50, new Set(), "live");
  expect(selected).toHaveLength(10);
  // A floor, not a ceiling: at least the reserved slots go to the session.
  expect(freshCount(selected)).toBeGreaterThanOrEqual(3);
  // And the remainder still goes to whatever scores best, which here is global.
  expect(selected.length - freshCount(selected)).toBeGreaterThan(0);
});

it("lets session terms exceed their reservation when they outrank everything", () => {
  // Session terms that are genuinely the most distinctive, and a reservation
  // of one slot in ten. The reservation is a floor, so they take far more.
  const store = fixture(0.1, 1, 5000);
  const selected = store.keyterms(baseline, 10, 50, new Set(), "live");
  expect(freshCount(selected)).toBeGreaterThan(1);
});

it("keeps every selected term unique", () => {
  const store = fixture(0.5, 5);
  const selected = store.keyterms(baseline, 20, 50, new Set(), "live");
  expect(new Set(selected).size).toBe(selected.length);
});
