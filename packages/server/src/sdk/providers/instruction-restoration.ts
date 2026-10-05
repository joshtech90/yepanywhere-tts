import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  INSTRUCTION_RESTORATION_PREAMBLE,
  parseInstructionRestorationSettings,
  type InstructionRestorationSettings,
} from "@yep-anywhere/shared";
import type { SDKMessage, ContentBlock } from "../types.js";
import type { AgentSession, StartSessionOptions } from "./types.js";
import {
  InstructionPackets,
  essentialInstructions,
  type InstructionFile,
} from "./instruction-packets.js";

export interface InstructionRestorationControl {
  settings: InstructionRestorationSettings | null;
  paused?: boolean;
}

/** Provider-owned read ledger: epochs contain delivered text, not command claims. */
export class InstructionRestoration {
  private settings: InstructionRestorationSettings | null = null;
  private packets: InstructionPackets | null = null;
  private paused = false;
  private generation = 0;
  private epoch = 0;
  private turns = 0;
  private compactTurn = false;
  private restorationTurn = false;
  private opened = new Map<string, string>();
  private satisfied = new Map<string, string>();
  private coverage = new Map<string, { hash: string; lines: Set<number> }>();
  private calls = new Map<string, InstructionFile[]>();
  private seen = new Set<string>();
  private attempted = false;
  private boundarySignature: string | undefined;
  private activityVersion = 0;
  private pendingDelivery:
    | { session: AgentSession; tempId: string; sources: InstructionFile[] }
    | undefined;

  constructor(
    private readonly cwd: string,
    private readonly diagnostic: (detail: string) => void,
  ) {}

  configure(control: InstructionRestorationControl): void {
    if (control.settings !== null) {
      const settings = parseInstructionRestorationSettings(control.settings);
      if (!settings?.pathPrefix)
        throw new Error("Invalid instruction restoration settings");
      control = { ...control, settings };
    }
    this.paused = control.paused === true;
    if (
      this.pendingDelivery &&
      (this.paused ||
        JSON.stringify(control.settings) !== JSON.stringify(this.settings))
    ) {
      const pending = this.pendingDelivery;
      if (pending.session.queue.removeByTempId(pending.tempId).length) {
        for (const source of pending.sources)
          this.satisfied.delete(source.path);
        this.attempted = false;
      }
      this.pendingDelivery = undefined;
    }
    if (JSON.stringify(control.settings) === JSON.stringify(this.settings))
      return;
    if (
      control.settings &&
      this.settings &&
      control.settings.pathPrefix === this.settings.pathPrefix &&
      control.settings.pattern === this.settings.pattern
    ) {
      this.generation++;
      this.settings = control.settings;
      return;
    }
    this.generation++;
    this.settings = control.settings;
    this.packets = control.settings
      ? new InstructionPackets(
          control.settings.pathPrefix,
          control.settings.pattern,
          this.cwd,
        )
      : null;
    this.opened.clear();
    this.satisfied.clear();
    this.coverage.clear();
    this.calls.clear();
    this.seen.clear();
    this.epoch = 0;
    this.boundarySignature = undefined;
    this.attempted = false;
  }

  dispose(): void {
    this.configure({ settings: null });
  }

  async observe(message: SDKMessage): Promise<void> {
    const packets = this.packets;
    if (!packets || message._isStreaming || message.parent_tool_use_id) return;
    const generation = this.generation;
    const id = message.uuid ? `${message.type}:${message.uuid}` : undefined;
    if (id && this.seen.has(id)) return;
    if (id) {
      if (this.seen.size >= 20000)
        this.seen.delete(this.seen.values().next().value!);
      this.seen.add(id);
    }
    if (message.type === "system" && message.subtype === "compact_boundary") {
      const signature = `${JSON.stringify(message)}:${this.activityVersion}`;
      if (signature === this.boundarySignature) return;
      this.boundarySignature = signature;
      this.epoch++;
      this.turns = 0;
      this.compactTurn = true;
      this.attempted = false;
      this.satisfied.clear();
      this.coverage.clear();
      this.calls.clear();
      return;
    }
    const content = message.message?.content ?? message.content;
    if (message.type === "assistant" || message.type === "user")
      this.activityVersion++;
    const text = resultText(content);
    if (
      message.type === "user" &&
      text.startsWith(INSTRUCTION_RESTORATION_PREAMBLE)
    ) {
      this.restorationTurn = true;
      for (const match of text.matchAll(
        /^Source: (.+\.mandatory-reread\.md)$/gm,
      )) {
        try {
          await this.credit(
            await packets.read(match[1]!),
            text,
            packets,
            generation,
          );
        } catch (error) {
          this.diagnostic(String(error));
        }
      }
    }
    if (message.type === "result") {
      if (this.epoch && !this.compactTurn && !this.restorationTurn)
        this.turns++;
      this.compactTurn = false;
      this.restorationTurn = false;
    }
    if (!Array.isArray(content)) return;
    for (const block of content as ContentBlock[]) {
      if (block.type === "tool_use" && block.id) {
        const files: InstructionFile[] = [];
        for (const name of readCandidates(
          block.name ?? "",
          block.input,
          this.cwd,
        )) {
          try {
            files.push(await packets.read(name));
          } catch {
            /* Nonmatching command arguments are not eligible files. */
          }
        }
        if (generation !== this.generation) return;
        if (files.length && this.calls.size < 256)
          this.calls.set(block.id, files);
      } else if (block.type === "tool_result" && block.tool_use_id) {
        const files = this.calls.get(block.tool_use_id);
        this.calls.delete(block.tool_use_id);
        if (!files || block.is_error) continue;
        const output = resultText(block.content);
        for (const file of files) {
          try {
            await this.credit(file, output, packets, generation);
          } catch (error) {
            this.diagnostic(String(error));
          }
        }
      }
    }
  }

  private async credit(
    file: InstructionFile,
    output: string,
    packets: InstructionPackets,
    generation: number,
  ): Promise<void> {
    const visible = output
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\d+(?:→|\t|\|) ?/, ""));
    const sources = await packets.sources(file);
    if (generation !== this.generation) return;
    for (const source of sources) {
      const sourceLines = (
        source.path === file.path
          ? source.text
          : essentialInstructions(source.text)
      )
        .trimEnd()
        .split(/\r?\n/);
      // Counts, not membership: a single repeated line cannot establish many lines of coverage.
      const remaining = new Map<string, number>();
      for (const line of visible)
        remaining.set(line, (remaining.get(line) ?? 0) + 1);
      const matching: number[] = [];
      for (const [index, line] of sourceLines.entries()) {
        const count = remaining.get(line) ?? 0;
        if (!line.trim() || !count) continue;
        matching.push(index);
        remaining.set(line, count - 1);
      }
      if (!matching.length) continue;
      if (!this.opened.has(source.path) && this.opened.size >= 128)
        throw new Error("Instruction restoration source limit (128) reached");
      this.opened.set(source.path, source.hash);
      const coverageKey = `${file.path}:${source.path}`;
      let coverage = this.coverage.get(coverageKey);
      if (!coverage || coverage.hash !== file.hash) {
        coverage = { hash: file.hash, lines: new Set() };
        this.coverage.set(coverageKey, coverage);
      }
      for (const index of matching) coverage.lines.add(index);
      const nonempty = sourceLines.filter((line) => line.trim()).length;
      if (nonempty && coverage.lines.size / nonempty >= 0.8)
        this.satisfied.set(source.path, source.hash);
    }
  }

  /** Force read inserts validated packet text; acceptance is not model consumption. */
  async forceRead(
    paths: readonly string[],
    session: AgentSession,
  ): Promise<"native-history" | "user-turn"> {
    const packets = this.packets;
    const generation = this.generation;
    if (!packets || this.paused)
      throw new Error("Instruction restoration is disabled or paused");
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.length > 128 ||
      paths.some((name) => typeof name !== "string" || !name.endsWith(".md"))
    )
      throw new Error("Instruction force read requires 1–128 sources");
    const files: InstructionFile[] = [];
    const sources: InstructionFile[] = [];
    for (const name of paths) {
      const file = await packets.read(
        name.replace(/\.md$/, ".mandatory-reread.md"),
      );
      sources.push(...(await packets.sources(file)));
      files.push(file);
    }
    if (generation !== this.generation || this.paused)
      throw new Error(
        "Instruction restoration configuration changed before delivery",
      );
    const text = `${INSTRUCTION_RESTORATION_PREAMBLE}\nEssential instructions restored into context; these sources need no extra read in this compaction epoch.\n\n${files.map((file) => `Source: ${file.path}\n${file.text}`).join("\n\n")}`;
    if (text.length > 262144)
      throw new Error("Instruction restoration exceeds context delivery bound");
    const native = await session.appendConversationContext?.([
      { role: "user", text },
    ]);
    if (!native) {
      if (generation !== this.generation || this.paused || session.queue.depth)
        throw new Error(
          "Instruction restoration deferred by configuration or user queue",
        );
      const tempId = randomUUID();
      session.queue.push({
        text,
        uuid: randomUUID(),
        tempId,
        automaticSource: "instruction-restoration",
      });
      this.pendingDelivery = { session, tempId, sources };
      this.restorationTurn = true;
    }
    this.activityVersion++;
    if (generation === this.generation)
      for (const source of sources)
        this.satisfied.set(source.path, source.hash);
    return native ? "native-history" : "user-turn";
  }

  async idle(session: AgentSession): Promise<void> {
    if (
      !this.settings ||
      !this.epoch ||
      this.paused ||
      this.attempted ||
      this.turns < this.settings.delayTurns ||
      session.queue.depth
    )
      return;
    const generation = this.generation;
    const pending: string[] = [];
    for (const name of this.opened.keys()) {
      try {
        const source = await this.packets!.read(name);
        if (this.satisfied.get(name) !== source.hash) pending.push(name);
      } catch (error) {
        this.diagnostic(String(error));
      }
    }
    if (generation !== this.generation || !pending.length) return;
    this.attempted = true;
    try {
      await this.forceRead(pending, session);
    } catch (error) {
      this.diagnostic(
        `Instruction restoration failed (not retried in this epoch): ${String(error)}`,
      );
    }
  }
}

function resultText(value: unknown): string {
  if (typeof value === "string") {
    // Code-mode batches log each command result as an escaped JSON line.
    return value
      .split("\n")
      .map((line) => {
        if (!line.startsWith("{")) return line;
        try {
          const record: unknown = JSON.parse(line);
          if (
            record &&
            typeof record === "object" &&
            "output" in record &&
            typeof record.output === "string"
          )
            return "exit_code" in record &&
              record.exit_code !== 0 &&
              record.exit_code !== null
              ? ""
              : record.output;
        } catch {
          /* Ordinary source text may begin with a brace. */
        }
        return line;
      })
      .join("\n");
  }
  if (Array.isArray(value))
    return value
      .map((part) => (part?.type === "text" ? resultText(part.text) : ""))
      .join("\n");
  return "";
}

/** Explicit reads and shell commands contribute paths only; results establish delivery. */
function readCandidates(name: string, input: unknown, cwd: string): string[] {
  if (!input || typeof input !== "object") return [];
  const args = input as Record<string, unknown>;
  if (name === "Exec" && Array.isArray(args.calls))
    return args.calls.flatMap((call) =>
      readCandidates(call.toolName, call.input, cwd),
    );
  if (/^(read|read_file)$/i.test(name)) {
    const file = args.file_path ?? args.path;
    return typeof file === "string" ? [file] : [];
  }
  const command = args.command ?? args.cmd;
  if (typeof command !== "string") return [];
  const workdir =
    typeof args.workdir === "string" ? path.resolve(cwd, args.workdir) : cwd;
  // Recognition is deliberately broader than cat: pipelines and wrappers still need matching output.
  return [
    ...command.matchAll(
      /"([^"\n]+\.md)"|'([^'\n]+\.md)'|([^\s;|&<>"'()]+\.md)/g,
    ),
  ]
    .map((match) => match[1] ?? match[2] ?? match[3]!)
    .map((name) =>
      name.startsWith("~/") ? name : path.resolve(workdir, name),
    );
}

/** Wraps the real adapter in its owning process, also usable without Hono or a browser. */
export function withInstructionRestoration(
  session: AgentSession,
  options: StartSessionOptions,
): AgentSession {
  const tracker = new InstructionRestoration(options.cwd, (detail) =>
    console.warn(detail),
  );
  const configure = (control: InstructionRestorationControl) => {
    if (
      control.settings &&
      (options.executor ||
        options.sessionSandbox ||
        options.sessionSandboxOptions?.level === "project-write")
    )
      throw new Error(
        "Instruction restoration requires verified session filesystem access; remote/sandboxed sessions are unsupported",
      );
    tracker.configure(control);
  };
  const isolated =
    options.executor ||
    options.sessionSandbox ||
    options.sessionSandboxOptions?.level === "project-write";
  if (isolated && options.instructionRestoration)
    console.warn(
      "Instruction restoration disabled: session filesystem access is not verified",
    );
  configure({
    settings: isolated ? null : (options.instructionRestoration ?? null),
  });
  const iterator = session.iterator;
  const history = options.instructionReadHistory ?? [];
  let releaseHistory: (() => void) | undefined;
  const historyReady = options.deferInstructionHistory
    ? new Promise<void>((resolve) => {
        releaseHistory = resolve;
      })
    : Promise.resolve();
  let tail = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const wrapped: AgentSession = {
    ...session,
    hydrateInstructionReadHistory: (messages, complete) =>
      serialize(async () => {
        if (!releaseHistory)
          throw new Error("Instruction history hydration is not pending");
        if (!Array.isArray(messages))
          throw new Error("Instruction history must be an array");
        for (const message of messages) await tracker.observe(message);
        if (complete) {
          releaseHistory();
          releaseHistory = undefined;
        }
      }),
    configureInstructionRestoration: async (control) => configure(control),
    forceReadInstructions: (paths) =>
      serialize(() => tracker.forceRead(paths, session)),
    iterator: (async function* () {
      try {
        await historyReady;
        for (const message of history)
          await serialize(() => tracker.observe(message));
        for await (const message of iterator) {
          await serialize(() => tracker.observe(message));
          yield message;
          if (message.type === "result")
            await serialize(() => tracker.idle(session));
        }
      } finally {
        tracker.dispose();
      }
    })(),
    abort: () => {
      tracker.dispose();
      releaseHistory?.();
      releaseHistory = undefined;
      return session.abort();
    },
  };
  return wrapped;
}
