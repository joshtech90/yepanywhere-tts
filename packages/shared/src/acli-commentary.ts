export interface AcliSourceSpan {
  start: number;
  end: number;
}

export const ACLI_COMMENTARY_MAX_TEXTS = 32;
export const ACLI_COMMENTARY_MAX_BODY_BYTES = 64 * 1024;

export function declaresAcliCommentary(line: string): boolean {
  return acliCommentaryFormat(line) !== null;
}

export function acliCommentaryFormat(line: string): "json" | "lines" | null {
  const declaration = line.trim().replace(/^#\s*/, "");
  const full = /^acli: 1(?:\s+(.*))?$/.exec(declaration);
  const narrow = /^acli-capabilities:\s+(.+)$/.exec(declaration);
  const tokens = (full?.[1] ?? narrow?.[1] ?? "").split(/\s+/);
  if (tokens.includes(full ? "+commentary-lines" : "commentary-lines/1"))
    return "lines";
  return tokens.includes(full ? "+commentary" : "commentary/1") ? "json" : null;
}

export interface AcliCommentaryItem {
  id: string;
  text: string;
  context: AcliSourceSpan | null;
}

export interface AcliRecord {
  source: string;
  data: string;
  commentary: AcliCommentaryItem[];
  removed: AcliSourceSpan[];
  metadataOnly: boolean;
  /** Valid JSON data is opaque to other text protocols. */
  json?: true;
}

interface JsonNode extends AcliSourceSpan {
  members?: { key: string; start: number; value: JsonNode }[];
  items?: JsonNode[];
}

function readNodes(source: string): JsonNode {
  // Validate with the native parser; this walk retains serialized member order
  // and source spans (including number spellings that JS cannot represent).
  JSON.parse(source);
  const token = /\s*("(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+)/y;
  let offset = 0;
  const next = () => {
    token.lastIndex = offset;
    const match = token.exec(source);
    if (!match) throw new Error("Missing JSON token");
    offset = token.lastIndex;
    return { text: match[1]!, start: offset - match[1]!.length };
  };
  const read = (depth: number): JsonNode => {
    if (depth > 128) throw new Error("JSON nesting exceeds commentary limit");
    const first = next();
    const node: JsonNode = { start: first.start, end: offset };
    if (first.text === "{") {
      node.members = [];
      const keys = new Set<string>();
      while (true) {
        const key = next();
        if (key.text === "}") break;
        const name = JSON.parse(key.text) as string;
        if (keys.has(name)) throw new Error("Ambiguous duplicate JSON member");
        keys.add(name);
        next();
        node.members.push({
          key: name,
          start: key.start,
          value: read(depth + 1),
        });
        if (next().text === "}") break;
      }
      node.end = offset;
    } else if (first.text === "[") {
      node.items = [];
      const saved = offset;
      if (next().text !== "]") {
        offset = saved;
        do {
          node.items.push(read(depth + 1));
        } while (next().text !== "]");
      }
      node.end = offset;
    }
    return node;
  };
  return read(0);
}

function commentaryTexts(source: string, node: JsonNode): string[] | null {
  const metadata = JSON.parse(source.slice(node.start, node.end));
  if (
    !metadata ||
    Array.isArray(metadata) ||
    typeof metadata !== "object" ||
    Object.keys(metadata).length !== 1 ||
    !Array.isArray(metadata.commentary) ||
    metadata.commentary.length === 0
  )
    return null;
  const texts: string[] = [];
  for (const item of metadata.commentary) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).length !== 1 ||
      typeof item.text !== "string" ||
      !item.text.trim()
    )
      return null;
    texts.push(item.text);
  }
  return texts;
}

function projectSpan(record: AcliRecord, span: AcliSourceSpan): string {
  const chunks: string[] = [];
  let offset = span.start;
  for (const removed of record.removed) {
    if (removed.start < span.start || removed.end > span.end) continue;
    chunks.push(record.source.slice(offset, removed.start));
    offset = removed.end;
  }
  chunks.push(record.source.slice(offset, span.end));
  return chunks.join("");
}

export function getAcliContext(
  record: AcliRecord,
  item: AcliCommentaryItem,
): string | null {
  return item.context ? projectSpan(record, item.context) : null;
}

export function decodeAcliRecord(source: string): AcliRecord {
  const record: AcliRecord = {
    source,
    data: source,
    commentary: [],
    removed: [],
    metadataOnly: false,
  };
  // Keep large records as ordinary output rather than building an unbounded
  // second syntax tree on the browser's rendering thread.
  if (source.length > 1024 * 1024) return record;
  if (!source.includes("_acli") && !source.includes("\\")) {
    try {
      JSON.parse(source);
      record.json = true;
    } catch {
      // Non-JSON progress lines retain their ordinary text interpretation.
    }
    return record;
  }
  let root: JsonNode;
  try {
    root = readNodes(source);
  } catch {
    // Malformed, truncated, excessively deep, or ambiguous output stays raw.
    return record;
  }
  record.json = true;
  const isMetadataOnly = (node: JsonNode) =>
    node.members?.length === 1 &&
    node.members[0]!.key === "_acli" &&
    commentaryTexts(source, node.members[0]!.value) !== null;
  const walk = (node: JsonNode, path: string, previous: JsonNode | null) => {
    if (node.items) {
      let preceding: JsonNode | null = null;
      node.items.forEach((item, index) => {
        walk(item, `${path}/${index}`, preceding);
        if (!isMetadataOnly(item)) preceding = item;
      });
    }
    node.members?.forEach((member, index, members) => {
      if (member.key !== "_acli") {
        walk(
          member.value,
          `${path}/${member.key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
          null,
        );
        return;
      }
      const texts = commentaryTexts(source, member.value);
      if (!texts) return;
      const context = isMetadataOnly(node)
        ? previous
        : node === root
          ? null
          : node;
      texts.forEach((text, item) => {
        record.commentary.push({
          id: `${path}/_acli/commentary/${item}`,
          text,
          context,
        });
      });
      const following = members[index + 1];
      const preceding = members[index - 1];
      record.removed.push({
        start: !following && preceding ? preceding.value.end : member.start,
        end: following ? following.start : member.value.end,
      });
    });
  };
  walk(root, "", null);
  record.removed.sort((a, b) => a.start - b.start);
  record.metadataOnly = isMetadataOnly(root);
  record.data = projectSpan(record, { start: 0, end: source.length });
  return record;
}

export function decodeAcliCommentaryLine(source: string): AcliRecord {
  const prefix = "# _acli.commentary: ";
  const text = source.startsWith(prefix)
    ? source.slice(prefix.length).replace(/\r?\n$/, "")
    : "";
  const valid = source.length <= 1024 * 1024 && !!text.trim();
  return {
    source,
    data: valid ? "" : source,
    commentary: valid ? [{ id: "line", text, context: null }] : [],
    removed: valid ? [{ start: 0, end: source.length }] : [],
    metadataOnly: valid,
  };
}

/** Splits records without rescanning an unfinished tail. */
export class AcliRecordFramer {
  private fragments: string[] = [];
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private json = false;
  private started = false;

  constructor(private format: "json" | "lines" = "json") {}

  append(chunk: string): string[] {
    const records: string[] = [];
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      const char = chunk[index]!;
      if (!this.started && !/\s/.test(char)) {
        this.started = true;
        this.json = this.format === "json" && (char === "{" || char === "[");
      }
      if (this.json) {
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (char === "\\") this.escaped = true;
          else if (char === '"') this.quoted = false;
        } else if (char === '"') this.quoted = true;
        else if (char === "{" || char === "[") this.depth++;
        else if (char === "}" || char === "]") this.depth--;
      }
      if (char === "\n" && (!this.json || (!this.quoted && this.depth <= 0))) {
        this.fragments.push(chunk.slice(start, index + 1));
        records.push(...this.finish());
        start = index + 1;
      }
    }
    if (start < chunk.length) this.fragments.push(chunk.slice(start));
    return records;
  }

  finish(): string[] {
    const source = this.fragments.join("");
    this.fragments = [];
    this.depth = 0;
    this.quoted = false;
    this.escaped = false;
    this.json = false;
    this.started = false;
    return source ? [source] : [];
  }
}
