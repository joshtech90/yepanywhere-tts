import { vocabularyDistinctiveScore } from "@yep-anywhere/shared";

const DEFAULT_LIMIT = 100;

export function distinctiveScore(
  count: number,
  total: number,
  frequency: number | undefined,
): number {
  return vocabularyDistinctiveScore(count, total, frequency);
}

/** Best-N words by the topic distinctive score; threshold is the current worst. */
export class DistinctiveTop {
  private readonly scores = new Map<string, number>();
  private worst = Number.NEGATIVE_INFINITY;

  constructor(private readonly limit = DEFAULT_LIMIT) {}

  consider(word: string, score: number): void {
    if (this.scores.has(word)) {
      this.scores.set(word, score);
      this.refreshWorst();
      return;
    }
    if (score <= 0) return;
    if (this.scores.size < this.limit) {
      this.scores.set(word, score);
      this.refreshWorst();
      return;
    }
    if (score <= this.worst) return;
    let evict: string | undefined;
    let evictScore = Infinity;
    for (const [candidate, value] of this.scores) {
      if (value < evictScore) {
        evict = candidate;
        evictScore = value;
      }
    }
    if (evict) this.scores.delete(evict);
    this.scores.set(word, score);
    this.refreshWorst();
  }

  private refreshWorst(): void {
    if (this.scores.size === 0) {
      this.worst = Number.NEGATIVE_INFINITY;
      return;
    }
    let worst = Infinity;
    for (const score of this.scores.values()) if (score < worst) worst = score;
    this.worst = worst;
  }

  ranked(): string[] {
    return [...this.scores]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([word]) => word);
  }

  entries(): ReadonlyMap<string, number> {
    return this.scores;
  }

  clear(): void {
    this.scores.clear();
    this.worst = Number.NEGATIVE_INFINITY;
  }

  rebuild(
    words: Iterable<[string, { user: number; assistant: number }]>,
    total: number,
    frequency: (word: string) => number | undefined,
    ignored: ReadonlySet<string>,
    maxLength = 50,
  ): void {
    this.clear();
    for (const [word, counts] of words) {
      if (ignored.has(word) || word.length > maxLength) continue;
      this.consider(
        word,
        distinctiveScore(
          counts.user + counts.assistant,
          total,
          frequency(word),
        ),
      );
    }
  }
}
