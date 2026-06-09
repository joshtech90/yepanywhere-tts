/**
 * Text chunking for TTS, ported 1:1 from the PocketClaude tts_engine
 * (split_into_chunks / _balanced_dp_chunks). The first chunk is kept small
 * (fast-start) so playback can begin almost immediately, while the remaining
 * chunks are balanced for even sizes.
 */

const PREFERRED_CHUNK_CHARS = 200;
const HARD_MAX_CHUNK_CHARS = 500;
const MAX_CHUNK_BYTES = 3800;
const MAX_CONCURRENT_TTS_REQUESTS = 50;
const BALANCED_MIN_RATIO = 0.5;
const FIRST_CHUNK_FAST_START_CHARS = 80;
export const CHUNKING_MIN_TOTAL_CHARS = 200;

const SENTENCE_BOUNDARY_RE = /(?<=[.!?:])\s+|\n{2,}|\n(?=[A-ZÄÖÜ])/;
const CLAUSE_BOUNDARY_RE = /(?<=[,;])\s+/;

const utf8Len = (t: string): number => Buffer.byteLength(t, "utf-8");

const withinLimit = (t: string, maxChars: number, maxBytes: number): boolean =>
  t.length <= maxChars && utf8Len(t) <= maxBytes;

function splitOversizeToken(
  token: string,
  maxChars: number,
  maxBytes: number,
): string[] {
  const parts: string[] = [];
  let buf: string[] = [];
  for (const ch of token) {
    const candidate = buf.join("") + ch;
    if (buf.length && !withinLimit(candidate, maxChars, maxBytes)) {
      parts.push(buf.join(""));
      buf = [ch];
    } else {
      buf.push(ch);
    }
  }
  if (buf.length) parts.push(buf.join(""));
  return parts;
}

function splitByWords(
  text: string,
  maxChars: number,
  maxBytes: number,
): string[] {
  const parts: string[] = [];
  let buf = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = buf ? `${buf} ${word}` : word;
    if (withinLimit(candidate, maxChars, maxBytes)) {
      buf = candidate;
      continue;
    }
    if (buf) {
      parts.push(buf);
      buf = "";
    }
    if (withinLimit(word, maxChars, maxBytes)) {
      buf = word;
    } else {
      parts.push(...splitOversizeToken(word, maxChars, maxBytes));
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

function ttsUnits(text: string, maxChars: number, maxBytes: number): string[] {
  const units: string[] = [];
  for (const rawSentence of text.split(SENTENCE_BOUNDARY_RE)) {
    const sentence = rawSentence?.trim();
    if (!sentence) continue;
    if (withinLimit(sentence, maxChars, maxBytes)) {
      units.push(sentence);
      continue;
    }
    for (const rawClause of sentence.split(CLAUSE_BOUNDARY_RE)) {
      const clause = rawClause?.trim();
      if (!clause) continue;
      if (withinLimit(clause, maxChars, maxBytes)) {
        units.push(clause);
      } else {
        units.push(...splitByWords(clause, maxChars, maxBytes));
      }
    }
  }
  return units;
}

function prefixLengths(units: string[], inBytes = false): number[] {
  const out = [0];
  let total = 0;
  for (const u of units) {
    total += inBytes ? utf8Len(u) : u.length;
    out.push(total);
  }
  return out;
}

function spanLen(prefix: number[], start: number, end: number): number {
  if (end <= start) return 0;
  return (prefix[end] as number) - (prefix[start] as number) + (end - start - 1);
}

function candidateCaps(preferred: number, hardMax: number, rounds = 5): number[] {
  const low = Math.max(1, Math.min(preferred, hardMax));
  const high = Math.max(preferred, hardMax);
  const caps = new Set<number>([low, high]);
  let intervals: Array<[number, number]> = [[low, high]];
  for (let r = 0; r < rounds; r++) {
    const next: Array<[number, number]> = [];
    for (const [s, e] of intervals) {
      if (e - s <= 1) continue;
      const m = Math.floor((s + e) / 2);
      caps.add(m);
      next.push([s, m]);
      next.push([m, e]);
    }
    intervals = next;
    if (!intervals.length) break;
  }
  return [...caps].sort((a, b) => a - b);
}

// Lexicographic comparison of the DP score tuples.
function tupleLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number);
  }
  return false;
}

interface PartitionResult {
  ranges: Array<[number, number]>;
  maxChunkLen: number;
  smallChunks: number;
  smallDeficit: number;
}

function balancedPartition(
  units: string[],
  charsPrefix: number[],
  bytesPrefix: number[],
  capChars: number,
  minChars: number,
  maxBytes: number,
): PartitionResult | null {
  const n = units.length;
  const best: (number[] | null)[] = new Array(n + 1).fill(null);
  const prev: number[] = new Array(n + 1).fill(-1);
  best[0] = [0, 0, 0, 0, 0];
  for (let end = 1; end <= n; end++) {
    for (let start = end - 1; start >= 0; start--) {
      const chars = spanLen(charsPrefix, start, end);
      if (chars > capChars) break;
      if (spanLen(bytesPrefix, start, end) > maxBytes) break;
      const prior = best[start];
      if (prior == null) continue;
      const deficit = Math.max(0, minChars - chars);
      const small = deficit ? 1 : 0;
      const cand = [
        (prior[0] as number) + 1,
        (prior[1] as number) + small,
        (prior[2] as number) + deficit,
        Math.max(prior[3] as number, chars),
        (prior[4] as number) + (capChars - chars) ** 2,
      ];
      if (best[end] === null || tupleLess(cand, best[end] as number[])) {
        best[end] = cand;
        prev[end] = start;
      }
    }
  }
  if (best[n] === null) return null;
  const ranges: Array<[number, number]> = [];
  let e = n;
  while (e > 0) {
    const s = prev[e] as number;
    if (s < 0) return null;
    ranges.push([s, e]);
    e = s;
  }
  ranges.reverse();
  const score = best[n] as number[];
  return {
    ranges,
    maxChunkLen: score[3] as number,
    smallChunks: score[1] as number,
    smallDeficit: score[2] as number,
  };
}

function waveScore(
  cap: number,
  chunkCount: number,
  maxChunkLen: number,
  smallChunks: number,
  smallDeficit: number,
  preferred: number,
  concurrency: number,
): number[] {
  const waves = Math.ceil(chunkCount / concurrency);
  const startupWeight = Math.max(100, preferred);
  const wallclock = waves * (startupWeight + maxChunkLen);
  return [wallclock, waves, maxChunkLen, smallDeficit, smallChunks, chunkCount, cap];
}

function balancedDpChunks(input: string): string[] {
  const text = input.trim();
  if (!text) return [];
  const minChars = Math.max(1, Math.round(PREFERRED_CHUNK_CHARS * BALANCED_MIN_RATIO));
  let bestChoice:
    | { ranges: Array<[number, number]>; units: string[]; score: number[] }
    | null = null;
  for (const cap of candidateCaps(PREFERRED_CHUNK_CHARS, HARD_MAX_CHUNK_CHARS)) {
    const units = ttsUnits(text, HARD_MAX_CHUNK_CHARS, MAX_CHUNK_BYTES);
    if (!units.length) continue;
    const charsPrefix = prefixLengths(units);
    const bytesPrefix = prefixLengths(units, true);
    const result = balancedPartition(
      units,
      charsPrefix,
      bytesPrefix,
      cap,
      minChars,
      MAX_CHUNK_BYTES,
    );
    if (!result) continue;
    const score = waveScore(
      cap,
      result.ranges.length,
      result.maxChunkLen,
      result.smallChunks,
      result.smallDeficit,
      PREFERRED_CHUNK_CHARS,
      MAX_CONCURRENT_TTS_REQUESTS,
    );
    if (bestChoice === null || tupleLess(score, bestChoice.score)) {
      bestChoice = { ranges: result.ranges, units, score };
    }
  }
  if (bestChoice === null) {
    return ttsUnits(text, HARD_MAX_CHUNK_CHARS, MAX_CHUNK_BYTES) || [text];
  }
  return bestChoice.ranges.map(([s, e]) => bestChoice.units.slice(s, e).join(" "));
}

/**
 * Find how many characters of `text` are consumed by `clauses` (each a trimmed
 * substring of `text`, in order). Walks a monotonic cursor and matches each
 * clause as a contiguous substring, returning the offset just past the last
 * match — i.e. the real prefix length accounting for whatever separators
 * (single/multiple spaces, newlines, tabs) sit between clauses in the original.
 * Returns null if any clause can't be matched contiguously, signalling the
 * caller to fall back to its previous length-based slice.
 */
function consumedPrefixLength(
  text: string,
  clauses: string[],
): number | null {
  let cursor = 0;
  let end = 0;
  for (const clause of clauses) {
    const idx = text.indexOf(clause, cursor);
    if (idx === -1) return null;
    end = idx + clause.length;
    cursor = end;
  }
  return end;
}

/**
 * Split text into TTS chunks. The first chunk is kept short (fast-start) so the
 * client can begin playback almost immediately.
 */
export function splitIntoChunks(input: string, fastStart = true): string[] {
  const text = input.trim();
  if (!text) return [];

  let firstChunk: string | null = null;
  let remainder = text;

  if (fastStart && text.length >= CHUNKING_MIN_TOTAL_CHARS) {
    const unitsForFirst = ttsUnits(text, HARD_MAX_CHUNK_CHARS, MAX_CHUNK_BYTES);
    const firstAtom = unitsForFirst[0];
    if (firstAtom) {
      if (firstAtom.length <= FIRST_CHUNK_FAST_START_CHARS) {
        firstChunk = firstAtom;
        remainder = text.slice(firstAtom.length).replace(/^\s+/, "");
      } else {
        const subs = firstAtom.split(CLAUSE_BOUNDARY_RE);
        let subBuf = "";
        const keptClauses: string[] = [];
        for (const rawSub of subs) {
          const sub = rawSub?.trim();
          if (!sub) continue;
          const candidate = subBuf ? `${subBuf} ${sub}`.trim() : sub;
          if (candidate.length <= FIRST_CHUNK_FAST_START_CHARS) {
            subBuf = candidate;
            keptClauses.push(sub);
          } else {
            break;
          }
        }
        if (subBuf && subBuf.length >= 20) {
          firstChunk = subBuf;
          // `subBuf` rejoins trimmed clauses with single spaces, so its length
          // can be shorter than the original prefix when the source used
          // multi-space or newline separators between clauses. Locate where the
          // last kept clause ends in the ORIGINAL text and slice from there, so
          // no separator chars leak into (or get dropped from) the remainder.
          // Falls back to `subBuf.length` if a clause isn't found contiguously
          // (e.g. a word-wrapped atom whose internal whitespace was collapsed),
          // which preserves the previous behavior for that edge case.
          const consumed = consumedPrefixLength(text, keptClauses);
          remainder = text
            .slice(consumed ?? subBuf.length)
            .replace(/^\s+/, "");
        }
      }
    }
  }

  const restChunks = remainder ? balancedDpChunks(remainder) : [];
  return (firstChunk ? [firstChunk] : []).concat(restChunks);
}
