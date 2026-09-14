// Hermit Dave's OpenSubtitles 2018 English counts, CC BY-SA 4.0.
// Pinned reference fetched on demand; no learned text is sent.
export const VOCABULARY_BASELINE_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/en/en_50k.txt";

export const MAX_SPEECH_SESSION_TERMS = 10000;
export const COMMON_VOCABULARY_LIMIT = 1000;
export const VOCABULARY_FLUSH_COUNTS = 1_000_000;

export function commonVocabularyWords(
  baseline: ReadonlyMap<string, number>,
  limit = COMMON_VOCABULARY_LIMIT,
): Set<string> {
  return new Set(
    [...baseline]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([word]) => word),
  );
}

const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:['_’.-][\p{L}\p{N}]+)*/gu;
/** Ends a sentence, so the next word's initial capital carries no case evidence. */
const SENTENCE_END = /[.!?:;]/;
/** Markup and punctuation that is not itself evidence of a preceding word. */
const DECORATION = /[\s#*_>`"'“”‘’()[\]{}|+~=\-–—/\\]/;
const HEADING_LINE = /^[ \t]*#{1,6}[ \t]/;

export interface SpeechVocabularyOccurrence {
  /** Lowercased, apostrophe-normalized token: the vocabulary key. */
  word: string;
  /** The token as written, apostrophe-normalized. */
  surface: string;
  /**
   * The position forces an initial capital — line start, sentence start, or a
   * Markdown heading — so this occurrence is no evidence of the word's case.
   */
  forced: boolean;
}

export function* speechVocabularyOccurrences(
  text: string,
): Generator<SpeechVocabularyOccurrence> {
  const source = text.normalize("NFKC");
  let heading = HEADING_LINE.test(source);
  let wordOnLine = false;
  let cursor = 0;
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const gap = source.slice(cursor, match.index);
    const newline = gap.lastIndexOf("\n");
    if (newline >= 0) {
      wordOnLine = false;
      heading = HEADING_LINE.test(gap.slice(newline + 1));
    }
    let forced = heading || !wordOnLine;
    for (let index = gap.length - 1; index > newline && !heading; index--) {
      const character = gap[index]!;
      if (DECORATION.test(character)) continue;
      forced = SENTENCE_END.test(character);
      break;
    }
    cursor = match.index + match[0].length;
    wordOnLine = true;
    const surface = match[0].replaceAll("’", "'");
    const word = surface.toLowerCase();
    if (/\p{L}/u.test(word) && word.length <= 100)
      yield { word, surface, forced };
  }
}

export function speechVocabularyTokens(text: string): string[] {
  const words: string[] = [];
  for (const { word } of speechVocabularyOccurrences(text)) words.push(word);
  return words;
}

/** Surface form → [occurrences in free position, occurrences in forced position]. */
export type VocabularyCaseForms = Record<string, [number, number]>;

export const MAX_VOCABULARY_CASE_FORMS = 3;

export function observeVocabularyCase(
  forms: VocabularyCaseForms,
  surface: string,
  forced: boolean,
): void {
  const existing = forms[surface];
  if (existing) {
    existing[forced ? 1 : 0]++;
    return;
  }
  const surfaces = Object.keys(forms);
  if (surfaces.length < MAX_VOCABULARY_CASE_FORMS) {
    forms[surface] = forced ? [0, 1] : [1, 0];
    return;
  }
  // Bounded frequent-form tracking: the newcomer takes the weakest slot and
  // inherits its counts, so a spelling that appears late can still overtake.
  const [weakest] = surfaces.sort(
    (a, b) =>
      forms[a]![0] + forms[a]![1] - (forms[b]![0] + forms[b]![1]) ||
      a.localeCompare(b),
  );
  const inherited = forms[weakest!]!;
  delete forms[weakest!];
  inherited[forced ? 1 : 0]++;
  forms[surface] = inherited;
}

/** A capital that no position can force, so it is always case evidence. */
export function hasInteriorCapital(surface: string): boolean {
  return /\p{Lu}/u.test(surface.slice(1));
}

/**
 * Weight of an all-lowercase spelling as evidence. Typing everything lowercase
 * is as common as capitalizing at a sentence start, so it leaves case open the
 * same way — for every character rather than only the first. Discounted rather
 * than ignored, since a lone stray capital must not outweigh settled usage.
 */
const LOWERCASE_EVIDENCE_WEIGHT = 0.25;

/**
 * The spelling to send a recognizer for a learned word. Free-position writing
 * decides the case; where a word was only ever seen where the position forces a
 * capital, only its interior letters are evidence.
 */
export function projectVocabularyCase(
  word: string,
  forms: VocabularyCaseForms | undefined,
): string {
  if (!forms) return word;
  const evidence = ([surface, [free]]: [string, [number, number]]): number =>
    free * (/\p{Lu}/u.test(surface) ? 1 : LOWERCASE_EVIDENCE_WEIGHT);
  const entries = Object.entries(forms);
  const free = entries
    .filter((entry) => evidence(entry) > 0)
    .sort(
      (left, right) =>
        evidence(right) - evidence(left) ||
        right[1][0] + right[1][1] - (left[1][0] + left[1][1]) ||
        left[0].localeCompare(right[0]),
    );
  if (free.length > 0) return free[0]![0];
  const [best] = entries.sort(
    ([left, [, leftForced]], [right, [, rightForced]]) =>
      rightForced - leftForced || left.localeCompare(right),
  );
  const surface = best?.[0];
  return surface && hasInteriorCapital(surface) ? surface : word;
}

export function parseVocabularyBaseline(
  text: string,
): ReadonlyMap<string, number> {
  if (text.length > 2_000_000)
    throw new Error("Vocabulary baseline exceeds its size limit");
  const counts = new Map<string, number>();
  let total = 0;
  for (const line of text.trim().split("\n")) {
    const match = /^(\S+) ([1-9][0-9]*)\r?$/.exec(line);
    if (!match) throw new Error("Invalid vocabulary baseline row");
    const word = match[1]!;
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || counts.has(word))
      throw new Error("Invalid vocabulary baseline count or duplicate word");
    counts.set(word, count);
    if (counts.size > 50000)
      throw new Error("Vocabulary baseline exceeds its row limit");
    total += count;
  }
  if (!Number.isSafeInteger(total) || total === 0)
    throw new Error("Invalid vocabulary baseline total");
  return new Map([...counts].map(([word, count]) => [word, count / total]));
}

/**
 * Reference frequency for a learned word. The published English list splits at
 * apostrophes, listing "'s", "'t" and "'ll" as their own rows, while YA keeps
 * such tokens joined. Contractions and possessives are therefore missing from
 * the list and would otherwise rank as maximally distinctive. A joined form is
 * never more common than any of its parts, so the smallest listed part bounds it.
 */
export function vocabularyFrequency(
  baseline: ReadonlyMap<string, number>,
  word: string,
): number | undefined {
  const listed = baseline.get(word);
  if (listed !== undefined) return listed;
  if (!word.includes("'")) return undefined;
  let bound: number | undefined;
  word.split("'").forEach((part, index) => {
    const frequency = baseline.get(index === 0 ? part : `'${part}`);
    if (frequency !== undefined && (bound === undefined || frequency < bound))
      bound = frequency;
  });
  return bound;
}

export function vocabularyDistinctiveScore(
  count: number,
  total: number,
  frequency: number | undefined,
): number {
  const expected = frequency === undefined ? 0 : total * frequency;
  return (count - expected) / Math.sqrt(expected + 1);
}

export function rankVocabulary(
  words: SpeechVocabularyWord[],
  total: number,
  baseline: ReadonlyMap<string, number>,
  minimum: number,
  distinctive: boolean,
  includeUnlisted = false,
) {
  return words
    .filter((word) => word.user + word.assistant >= minimum)
    .map((word) => {
      const count = word.user + word.assistant;
      const frequency = vocabularyFrequency(baseline, word.word);
      const expected = frequency === undefined ? undefined : total * frequency;
      return {
        ...word,
        count,
        ratio: expected ? count / expected : undefined,
        score: vocabularyDistinctiveScore(count, total, frequency),
      };
    })
    .filter(
      (word) =>
        !distinctive ||
        (word.score > 0 && (includeUnlisted || word.ratio !== undefined)),
    )
    .sort(
      (a, b) =>
        (distinctive ? b.score - a.score : b.count - a.count) ||
        a.word.localeCompare(b.word),
    );
}

export interface SpeechVocabularyWord {
  word: string;
  user: number;
  assistant: number;
}

export interface SpeechVocabularyStatus {
  generation: number;
  enabled: boolean;
  biasing: boolean;
  hours: number;
  /** Weight of an active-session term against the same term scored globally. */
  sessionMultiplier: number;
  /** Share of the selected keyterms held for the active session, 0 to 1. */
  sessionShare: number;
  totals: { words: number; user: number; assistant: number };
  /** Present only when the lexicon view requests includeWords=1; at most 2000. */
  words?: SpeechVocabularyWord[];
  scan: {
    state: "idle" | "scanning" | "error";
    sessions: number;
    messages: number;
    error?: string;
  };
  integration: "grok-via-ya";
}
