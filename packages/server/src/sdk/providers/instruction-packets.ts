import { createHash } from "node:crypto";
import { open, realpath, opendir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const instructionHash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** Extracts the compiler's marked essential instruction spans. */
export function essentialInstructions(source: string): string {
  const lines: string[] = [];
  let opened = false;
  for (const line of source.split(/\r?\n/)) {
    if (line === "<!-- reread:begin -->") {
      if (opened)
        throw new Error("Instruction packet has nested reread markers");
      opened = true;
    } else if (line === "<!-- reread:end -->") {
      if (!opened)
        throw new Error("Instruction packet has unmatched reread end");
      opened = false;
      lines.push("");
    } else if (
      line.startsWith("<!-- reread:include ") &&
      line.endsWith(" -->")
    ) {
      // Includes are compiler dependencies, not essential source text.
    } else if (line.startsWith("<!-- reread:")) {
      throw new Error("Instruction packet has invalid reread marker");
    } else if (opened) lines.push(line);
  }
  if (opened) throw new Error("Instruction packet has unclosed reread block");
  return lines.join("\n").trim();
}

export interface InstructionFile {
  path: string;
  text: string;
  hash: string;
}

/** A real-path boundary; callers must already be in the session filesystem. */
export class InstructionPackets {
  async preview(): Promise<{
    prefix: string;
    matches: string[];
    truncated: boolean;
  }> {
    const prefix = await realpath(this.expand(this.prefix));
    const directories = [prefix];
    const matches = new Set<string>();
    let visited = 0;
    while (directories.length) {
      const directory = await opendir(directories.shift()!);
      for await (const entry of directory) {
        if (++visited > 2000 || matches.size >= 100)
          return { prefix, matches: [...matches], truncated: true };
        const candidate = path.join(directory.path, entry.name);
        if (entry.isDirectory()) directories.push(candidate);
        else if (
          entry.name.endsWith(".md") &&
          !entry.name.includes(".mandatory-reread")
        ) {
          try {
            matches.add((await this.read(candidate)).path);
          } catch {
            /* Preview lists only files accepted by the same real-path boundary. */
          }
        }
      }
    }
    return { prefix, matches: [...matches].sort(), truncated: false };
  }
  constructor(
    readonly prefix: string,
    readonly pattern: string,
    readonly cwd: string,
  ) {}

  private expand(name: string): string {
    return name.startsWith("~/")
      ? path.join(homedir(), name.slice(2))
      : path.resolve(this.cwd, name);
  }

  async read(name: string): Promise<InstructionFile> {
    const root = await realpath(this.expand(this.prefix));
    const resolved = await realpath(this.expand(name));
    const relative = path.relative(root, resolved);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Instruction path outside permitted prefix: ${name}`);
    }
    const base = relative
      .replace(/\.mandatory-reread(?:\.recursive)?\.md$/, ".md")
      .split(path.sep)
      .join("/");
    const glob = this.pattern
      .split("**")
      .map((part) =>
        part
          .split("*")
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*"),
      )
      .join(".*");
    if (!new RegExp(`^${glob}$`).test(base))
      throw new Error(`Instruction path does not match pattern: ${name}`);
    const file = await open(resolved, "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024)
        throw new Error(`Instruction file exceeds read bounds: ${name}`);
      const text = (await file.readFile("utf8")).replace(/\r\n/g, "\n");
      if (Buffer.byteLength(text) > 1024 * 1024)
        throw new Error(`Instruction file changed beyond read bounds: ${name}`);
      return { path: resolved, text, hash: instructionHash(text) };
    } finally {
      await file.close();
    }
  }

  /** Validates source hashes and every included body, never trusting headers alone. */
  async sources(file: InstructionFile): Promise<InstructionFile[]> {
    if (!/\.mandatory-reread(?:\.recursive)?\.md$/.test(file.path))
      return [file];
    const coverage = this.manifest(file.text, "reread-coverage");
    const hashes = this.manifest(file.text, "reread-source-hashes");
    const ownBase = file.path.replace(
      /\.mandatory-reread(?:\.recursive)?\.md$/,
      ".md",
    );
    const ownKey = Object.keys(hashes).find((key) =>
      ownBase.split(path.sep).join("/").endsWith(`/${key}`),
    );
    if (!ownKey)
      throw new Error(`Instruction packet has no owning source: ${file.path}`);
    const sourceRoot = ownBase.slice(0, -ownKey.length);
    const sources: InstructionFile[] = [];
    for (const [key, hash] of Object.entries(hashes)) {
      const source = await this.read(path.resolve(sourceRoot, key));
      const essential = essentialInstructions(source.text);
      if (
        !essential ||
        source.hash !== hash ||
        instructionHash(essential) !== coverage[key] ||
        !file.text.includes(`<!-- source: ${key} -->\n${essential}`)
      ) {
        throw new Error(
          `Instruction packet is stale or incomplete: ${file.path} (${key})`,
        );
      }
      sources.push(source);
    }
    if (sources.length !== Object.keys(coverage).length)
      throw new Error(`Instruction packet coverage mismatch: ${file.path}`);
    return sources;
  }

  private manifest(text: string, name: string): Record<string, string> {
    const match = text.match(new RegExp(`<!-- ${name}: (.+) -->`));
    if (!match) throw new Error(`Instruction packet missing ${name}`);
    const value: unknown = JSON.parse(match[1]!);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !Object.entries(value).every(
        ([key, hash]) =>
          !path.isAbsolute(key) &&
          !key.split(/[\\/]/).includes("..") &&
          typeof hash === "string" &&
          /^[a-f0-9]{64}$/.test(hash),
      )
    )
      throw new Error(`Instruction packet invalid ${name}`);
    return value as Record<string, string>;
  }
}
