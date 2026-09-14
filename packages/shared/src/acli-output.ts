import {
  AcliRecordFramer,
  acliCommentaryFormat,
  decodeAcliCommentaryLine,
  decodeAcliRecord,
  type AcliRecord,
} from "./acli-commentary.js";

export interface AcliDecodedRecord {
  id: number;
  record: AcliRecord;
  getPreviousContext: (() => string) | null;
}

export interface AcliOutputFragment {
  id: string;
  text: string;
  kind: "data" | "commentary";
  opaque?: boolean;
}

export function initialAcliFormat(source: string, complete: boolean) {
  const prefix = source.slice(0, 4097);
  const newline = prefix.indexOf("\n");
  const first = newline < 0 ? prefix : prefix.slice(0, newline);
  return (newline >= 0 || complete) && first.length <= 4096
    ? acliCommentaryFormat(first)
    : null;
}

/** One append-only producer stream, independent of rendering and workflow tags. */
export class AcliStreamDecoder {
  source = "";
  private framer: AcliRecordFramer | null = null;
  private format: "json" | "lines" | "raw" = "raw";
  private previous: AcliRecord | null = null;
  private textBlock: string[] = [];
  private afterCommentary = false;
  private nextId = 0;

  constructor(private channel: "stdout" | "stderr" | "unknown" = "stdout") {}

  appendSnapshot(
    source: string,
    complete: boolean,
    jsonDeclared: boolean,
  ): AcliDecodedRecord[] {
    let offset = this.source.length;
    if (!this.framer) {
      const newline = source.indexOf("\n");
      if (newline < 0 && !complete) return [];
      const format = initialAcliFormat(source, complete);
      this.format =
        format === "lines" ? "lines" : jsonDeclared ? "json" : "raw";
      this.framer = new AcliRecordFramer(
        this.format === "json" ? "json" : "lines",
      );
      if (format) offset = newline < 0 ? source.length : newline + 1;
    }
    const frames = this.framer.append(source.slice(offset));
    this.source = source;
    if (complete) frames.push(...this.framer.finish());
    return frames.map((frame) => {
      const record =
        this.format === "json"
          ? decodeAcliRecord(frame)
          : this.format === "lines"
            ? decodeAcliCommentaryLine(frame)
            : {
                source: frame,
                data: frame,
                commentary: [],
                removed: [],
                metadataOnly: false,
              };
      let getPreviousContext: (() => string) | null = null;
      if (
        this.channel === "stdout" ||
        (this.channel === "unknown" && this.format === "json")
      ) {
        const previous = this.previous;
        const block = this.textBlock;
        if (this.format === "lines" && block.length)
          getPreviousContext = () => block.join("");
        else if (previous) getPreviousContext = () => previous.data;
      }
      if (record.metadataOnly) this.afterCommentary = true;
      else {
        if (this.format === "lines") {
          if (this.afterCommentary) this.textBlock = [];
          this.textBlock.push(record.data);
        }
        this.afterCommentary = false;
        if (frame.trim()) this.previous = record;
      }
      return { id: this.nextId++, record, getPreviousContext };
    });
  }
}

export function acliRecordFragments(
  id: string,
  record: AcliRecord,
): AcliOutputFragment[] {
  return [
    ...(!record.metadataOnly
      ? [{ id, text: record.data, kind: "data" as const, opaque: record.json }]
      : []),
    ...record.commentary.map((item) => ({
      id: `${id}:${item.id}`,
      text: item.text,
      kind: "commentary" as const,
    })),
  ];
}
