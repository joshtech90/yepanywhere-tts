// Unicode classifications are immutable; allocate only the 256-codepoint pages used.
const characterPages: Array<Uint8Array | undefined> = [];
const PLAIN = 1;
const SINGLE_CELL = 2;
const DIAGRAM = 4;
const printable = /[\p{P}\p{S}]/u;
const naturallyWide =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}]/u;

function characterKind(character: string): number {
  const point = character.codePointAt(0)!;
  if (point < 0x80) return PLAIN;
  let page = characterPages[point >>> 8];
  if (!page) {
    page = new Uint8Array(256);
    characterPages[point >>> 8] = page;
  }
  const offset = point & 255;
  const cached = page[offset];
  if (cached) return cached;
  const wide =
    naturallyWide.test(character) ||
    (point >= 0x3000 && point <= 0x303f) ||
    (point >= 0xff01 && point <= 0xff60) ||
    (point >= 0xffe0 && point <= 0xffe6);
  const diagram =
    (point >= 0x2500 && point <= 0x25ff) ||
    (point >= 0x2800 && point <= 0x28ff) ||
    (point >= 0x1fb00 && point <= 0x1fbff);
  const kind =
    !wide && printable.test(character)
      ? SINGLE_CELL | (diagram ? DIAGRAM : 0)
      : PLAIN;
  page[offset] = kind;
  return kind;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function singleCellGlyphs(text: string): Map<string, number> {
  const glyphs = new Map<string, number>();
  for (const { segment } of segmenter.segment(text)) {
    // Keep combining sequences, emoji sequences and contextual scripts intact.
    if ([...segment].length !== 1) continue;
    const kind = characterKind(segment);
    if (kind & SINGLE_CELL) glyphs.set(segment, kind);
  }
  return glyphs;
}

const GRID_ATTRIBUTE = "data-ya-code-grid";
const CELL_ATTRIBUTE = "data-ya-code-cell";
const FIT_ATTRIBUTE = "data-ya-code-glyph";

/** Normalize code grid symbols without changing source text or highlighted tokens. */
export function createCodeGridNormalizer(doc: Document) {
  // Bounded by mounted code elements; replaced markup and unmounted blocks collect.
  let processed = new WeakMap<HTMLElement, string>();
  const revisions = new WeakMap<HTMLElement, object>();
  // Each font/glyph pair is measured once after its web fonts load, up to 4096 pairs.
  const advances = new Map<string, Promise<number>>();
  let canvas: CanvasRenderingContext2D | null = null;
  let disposed = false;

  function advance(font: string, glyph: string): Promise<number> {
    const key = `${font}\n${glyph}`;
    const cached = advances.get(key);
    if (cached) return cached;
    const result = doc.fonts.load(font, `0${glyph}`).then(() => {
      canvas ??= doc.createElement("canvas").getContext("2d");
      if (!canvas) throw new Error("Code grid font measurement needs canvas");
      canvas.font = font;
      canvas.fontKerning = "none";
      return canvas.measureText(glyph).width / canvas.measureText("0").width;
    });
    advances.set(key, result);
    if (advances.size > 4096) advances.delete(advances.keys().next().value!);
    return result;
  }

  function fontOf(element: HTMLElement): string {
    const style = getComputedStyle(element);
    return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  }

  async function normalize(code: HTMLElement): Promise<void> {
    const source = code.textContent ?? "";
    if (processed.get(code) === code.innerHTML) return;
    const revision = {};
    revisions.set(code, revision);
    processed.set(code, code.innerHTML);
    const pre = code.parentElement!;
    pre.removeAttribute(GRID_ATTRIBUTE);
    // Rebuild only our wrappers; syntax-highlight spans and links stay owned by their renderer.
    for (const cell of code.querySelectorAll(`[${CELL_ATTRIBUTE}]`)) {
      cell.replaceWith(doc.createTextNode(cell.textContent ?? ""));
    }
    processed.set(code, code.innerHTML);
    const glyphs = /[\u0080-\u{10ffff}]/u.test(source)
      ? singleCellGlyphs(source)
      : new Map<string, number>();
    const art =
      (source.includes("\n") &&
        [...source].filter((character) => characterKind(character) & DIAGRAM)
          .length >= 4) ||
      /(?:^|\n)\s*[+|][+|\- =]{3,}(?:\n|$)/u.test(source);
    if (!art && glyphs.size === 0) {
      pre.removeAttribute(GRID_ATTRIBUTE);
      return;
    }
    const originalFont = fontOf(code);
    const widths = art
      ? []
      : await Promise.all(
          [...glyphs.keys()].map((glyph) => advance(originalFont, glyph)),
        );
    if (
      disposed ||
      !code.isConnected ||
      revisions.get(code) !== revision ||
      code.textContent !== source
    )
      return;
    if (!art && !widths.some((width) => Math.abs(width - 1) > 0.01)) return;
    pre.setAttribute(GRID_ATTRIBUTE, "");

    const walker = doc.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const replacements = await Promise.all(
      nodes.map(async (node) => {
        const text = node.data;
        const candidates = singleCellGlyphs(text);
        if (candidates.size === 0) return;
        const font = fontOf(node.parentElement!);
        const scales = new Map(
          await Promise.all(
            [...candidates.keys()].map(
              async (glyph) =>
                [glyph, 1 / (await advance(font, glyph))] as const,
            ),
          ),
        );
        const fragment = doc.createDocumentFragment();
        let plain = "";
        for (const { segment } of segmenter.segment(text)) {
          const scale = scales.get(segment);
          if (scale === undefined || Math.abs(scale - 1) < 0.01) {
            plain += segment;
            continue;
          }
          if (plain) fragment.append(doc.createTextNode(plain));
          plain = "";
          const cell = doc.createElement("span");
          cell.setAttribute(CELL_ATTRIBUTE, "");
          const glyph = doc.createElement("span");
          glyph.setAttribute(FIT_ATTRIBUTE, "");
          glyph.style.setProperty("--code-glyph-scale", String(scale));
          glyph.textContent = segment;
          cell.append(glyph);
          fragment.append(cell);
        }
        if (plain) fragment.append(doc.createTextNode(plain));
        return { node, text, fragment };
      }),
    );
    if (
      disposed ||
      !code.isConnected ||
      revisions.get(code) !== revision ||
      code.textContent !== source
    )
      return;
    for (const replacement of replacements) {
      if (
        replacement &&
        code.contains(replacement.node) &&
        replacement.node.data === replacement.text
      ) {
        replacement.node.replaceWith(replacement.fragment);
      }
    }
    processed.set(code, code.innerHTML);
  }

  return {
    normalize,
    invalidate() {
      processed = new WeakMap();
      advances.clear();
    },
    dispose() {
      disposed = true;
      advances.clear();
    },
  };
}
