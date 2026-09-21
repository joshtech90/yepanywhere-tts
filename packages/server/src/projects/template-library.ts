import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const destination = z.string().refine((value) => {
  if (/[\\:]/.test(value) || [...value].some((char) => char.charCodeAt(0) < 32))
    return false;
  return value
    .split("/")
    .every(
      (part) =>
        !["", ".", "..", ".git"].includes(part.toLowerCase()) &&
        !/[. ]$/.test(part) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part),
    );
}, "Invalid portable template destination");
const contribution = z.strictObject({
  to: destination,
  from: z.string().min(1),
  executable: z.boolean().optional(),
});
const override = z.discriminatedUnion("op", [
  contribution.extend({ op: z.literal("replace") }),
  z.strictObject({ op: z.literal("omit"), to: destination }),
  z.strictObject({
    op: z.literal("append"),
    to: destination,
    from: z.string().min(1),
  }),
  z.strictObject({
    op: z.literal("prepend"),
    to: destination,
    from: z.string().min(1),
  }),
]);
const manifest = z.strictObject({
  formatVersion: z.literal(1),
  kind: z.enum(["base", "template"]),
  status: z.enum(["draft", "ready"]),
  id: identifier,
  title: z.string().refine((value) => value.trim().length > 0),
  description: z.string().refine((value) => value.trim().length > 0),
  extends: z.array(identifier),
  files: z.array(contribution),
  overrides: z.array(override),
});
const inventory = z.strictObject({
  formatVersion: z.literal(1),
  bases: z.array(identifier),
  templates: z.array(identifier),
});

export type TemplateManifest = z.infer<typeof manifest>;
type FileEntry = z.infer<typeof contribution>;
type OverrideEntry = z.infer<typeof override>;
export interface TemplateFile {
  content: Buffer;
  executable: boolean;
  sources: string[];
}
export interface TemplateComposition {
  template: TemplateManifest;
  order: string[];
  files: Map<string, TemplateFile>;
}
interface LoadedNode {
  manifest: TemplateManifest;
  files: Map<FileEntry | OverrideEntry, TemplateFile>;
}

function textBytes(content: Buffer): void {
  new TextDecoder("utf-8", { fatal: true }).decode(content);
  if (content.includes(0)) throw new Error("Template text contains a NUL byte");
}

function joinText(left: Buffer, right: Buffer, lines: number): Buffer {
  if (!left.length || !right.length) return Buffer.concat([left, right]);
  let trailing = 0;
  let leading = 0;
  while (left[left.length - 1 - trailing] === 10) trailing++;
  while (right[leading] === 10) leading++;
  return Buffer.concat([
    left,
    Buffer.alloc(Math.max(0, lines - trailing - leading), 10),
    right,
  ]);
}

/** Loads a template library without executing source code; retained bytes form a snapshot. */
export class TemplateLibrary {
  private constructor(
    private readonly nodes: Map<string, LoadedNode>,
    private readonly origins = new Map<string, string>(),
  ) {}

  static async load(
    repository: string,
    contentPath: string,
  ): Promise<TemplateLibrary> {
    return TemplateLibrary.loadSources([
      { id: "local", repository, contentPath },
    ]);
  }

  static async loadSources(
    sources: { id: string; repository: string; contentPath: string }[],
  ): Promise<TemplateLibrary> {
    const nodes = new Map<string, LoadedNode>();
    const origins = new Map<string, string>();
    for (const source of sources) {
      for (const [id, node] of await TemplateLibrary.readNodes(
        source.repository,
        source.contentPath,
      )) {
        if (
          nodes.has(id) &&
          nodes.get(id)?.manifest.kind !== node.manifest.kind
        )
          throw new Error(`Source changes the kind of ${id}`);
        nodes.set(id, node);
        origins.set(id, source.id);
      }
    }
    for (const { manifest: node } of nodes.values()) {
      if (
        new Set(node.extends).size !== node.extends.length ||
        node.extends.some((id) => nodes.get(id)?.manifest.kind !== "base")
      )
        throw new Error(`Unknown or repeated base in ${node.id}`);
    }
    const library = new TemplateLibrary(nodes, origins);
    for (const [id, node] of nodes) {
      library.order(id);
      if (node.manifest.kind === "template") library.compose(id);
    }
    return library;
  }

  sourceOf(id: string): string {
    const source = this.origins.get(id);
    if (!source) throw new Error(`Unknown template or base: ${id}`);
    return source;
  }

  private static async readNodes(
    repository: string,
    contentPath: string,
  ): Promise<Map<string, LoadedNode>> {
    const root = await realpath(repository);
    const sourcePath = async (directory: string, source: string) => {
      if (
        !source ||
        isAbsolute(source) ||
        /[\\:]/.test(source) ||
        source.includes(String.fromCharCode(0)) ||
        source.split("/").some((part) => part.toLowerCase() === ".git")
      ) {
        throw new Error(`Invalid template source: ${source}`);
      }
      const resolved = await realpath(join(directory, source));
      const local = relative(root, resolved);
      if (
        isAbsolute(local) ||
        local === ".." ||
        local.startsWith(`..${sep}`) ||
        local.split(sep).some((part) => part.toLowerCase() === ".git")
      ) {
        throw new Error(`Template source escapes repository: ${source}`);
      }
      return resolved;
    };
    const readJson = async (
      directory: string,
      name: string,
    ): Promise<unknown> =>
      JSON.parse(await readFile(await sourcePath(directory, name), "utf8"));
    const contentRoot =
      contentPath === ""
        ? root
        : await sourcePath(root, destination.parse(contentPath));
    const list = inventory.parse(await readJson(contentRoot, "library.json"));
    const nodes = new Map<string, LoadedNode>();
    for (const [kind, ids] of [
      ["base", list.bases],
      ["template", list.templates],
    ] as const) {
      for (const id of ids) {
        if (nodes.has(id) || (id === "base" && kind !== "base")) {
          throw new Error(`Duplicate or reserved template identifier: ${id}`);
        }
        const directory = join(contentRoot, `${kind}s`, id);
        const node = manifest.parse(await readJson(directory, "template.json"));
        if (
          node.id !== id ||
          node.kind !== kind ||
          (kind === "base" && node.overrides.length)
        ) {
          throw new Error(`Invalid template manifest: ${id}`);
        }
        const files = new Map<FileEntry | OverrideEntry, TemplateFile>();
        for (const entry of [...node.files, ...node.overrides]) {
          if (!("from" in entry)) continue;
          const path = await sourcePath(directory, entry.from);
          if (!(await stat(path)).isFile())
            throw new Error(`Template source is not a file: ${path}`);
          const content = await readFile(path);
          const executable = "executable" in entry && entry.executable === true;
          if (
            entry.to === "AGENTS.md" ||
            ("op" in entry && ["append", "prepend"].includes(entry.op))
          ) {
            textBytes(content);
            if (entry.to === "AGENTS.md" && executable)
              throw new Error(
                "Template root instructions cannot be executable",
              );
          }
          files.set(entry, {
            content,
            executable,
            sources: [relative(root, path).split(sep).join("/")],
          });
        }
        nodes.set(id, { manifest: node, files });
      }
    }
    return nodes;
  }

  list(): TemplateManifest[] {
    return [...this.nodes.values()]
      .map((node) => node.manifest)
      .filter((node) => node.kind === "template");
  }

  private order(id: string): string[] {
    const edges = new Map<string, Set<string>>();
    const visit = (name: string) => {
      if (edges.has(name)) return;
      edges.set(name, new Set());
      const bases = this.nodes.get(name)!.manifest.extends;
      for (const base of bases) {
        visit(base);
        edges.get(base)!.add(name);
      }
      for (let i = 1; i < bases.length; i++)
        edges.get(bases[i - 1]!)!.add(bases[i]!);
    };
    visit(id);
    const incoming = new Map([...edges.keys()].map((name) => [name, 0]));
    for (const children of edges.values()) {
      for (const child of children)
        incoming.set(child, incoming.get(child)! + 1);
    }
    const order: string[] = [];
    while (incoming.size) {
      const ready = [...incoming].find(([, count]) => count === 0)?.[0];
      if (!ready)
        throw new Error(
          `Conflicting template base order or cycle: ${[...incoming.keys()].join(", ")}`,
        );
      order.push(ready);
      incoming.delete(ready);
      for (const child of edges.get(ready)!)
        incoming.set(child, incoming.get(child)! - 1);
    }
    return order;
  }

  /** Composes drafts for inspection; creation must use readyComposition. */
  compose(id: string): TemplateComposition {
    const selected = this.nodes.get(id);
    if (selected?.manifest.kind !== "template")
      throw new Error(`Unknown project template: ${id}`);
    const order = this.order(id);
    if (
      selected.manifest.status === "ready" &&
      order.some((name) => this.nodes.get(name)!.manifest.status !== "ready")
    ) {
      throw new Error(`Ready template inherits draft base: ${id}`);
    }
    const files = new Map<string, TemplateFile>();
    const conflicts = new Set<string>();
    const hashes = new Set<string>();
    for (const name of order) {
      const node = this.nodes.get(name)!;
      for (const entry of node.manifest.files) {
        const item = node.files.get(entry)!;
        const previous = files.get(entry.to);
        const sources = [...(previous?.sources ?? []), ...item.sources];
        let content = item.content;
        if (entry.to === "AGENTS.md") {
          const hash = createHash("sha256").update(content).digest("hex");
          if (hashes.has(hash)) {
            files.set(entry.to, { ...previous!, sources });
            continue;
          }
          hashes.add(hash);
          if (previous) content = joinText(previous.content, content, 2);
        } else if (
          previous &&
          (!previous.content.equals(content) ||
            previous.executable !== item.executable)
        ) {
          conflicts.add(entry.to);
        }
        files.set(entry.to, { content, executable: item.executable, sources });
      }
    }
    for (const entry of selected.manifest.overrides) {
      const previous = files.get(entry.to);
      if (conflicts.has(entry.to) && !["replace", "omit"].includes(entry.op)) {
        throw new Error(`Unresolved template conflict: ${entry.to}`);
      }
      conflicts.delete(entry.to);
      if (entry.op !== "replace" && !previous)
        throw new Error(`Template override needs existing file: ${entry.to}`);
      if (entry.op === "omit") {
        files.delete(entry.to);
        continue;
      }
      const item = selected.files.get(entry)!;
      let content = item.content;
      let executable = item.executable;
      if (entry.op === "append" || entry.op === "prepend") {
        textBytes(previous!.content);
        content =
          entry.op === "append"
            ? joinText(previous!.content, content, 1)
            : joinText(content, previous!.content, 1);
        executable = previous!.executable;
      }
      files.set(entry.to, {
        content,
        executable,
        sources: [...(previous?.sources ?? []), ...item.sources],
      });
    }
    if (conflicts.size)
      throw new Error(
        `Template file conflicts: ${[...conflicts].map((path) => `${path} (${files.get(path)!.sources.join(", ")})`).join("; ")}`,
      );
    const portable = new Map<string, string>();
    for (const path of files.keys()) {
      // Preserve dotless i; lower first so capital sharp S expands with sharp s.
      const folded = [...path]
        .map((char) =>
          char === "ı" ? char : char.toLowerCase().toUpperCase().toLowerCase(),
        )
        .join("");
      if (portable.has(folded))
        throw new Error(
          `Template path collision: ${path}, ${portable.get(folded)}`,
        );
      portable.set(folded, path);
    }
    for (const path of portable.keys()) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) {
        if (portable.has(parts.slice(0, i).join("/")))
          throw new Error(`Template file/directory collision: ${path}`);
      }
    }
    return { template: selected.manifest, order, files };
  }

  readyComposition(id: string): TemplateComposition {
    const result = this.compose(id);
    if (result.template.status !== "ready")
      throw new Error(`Project template is draft: ${id}`);
    return result;
  }
}
