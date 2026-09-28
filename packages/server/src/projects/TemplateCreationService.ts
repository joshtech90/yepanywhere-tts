import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { z } from "zod";
import { initializeProjectGit } from "../routes/project-creation.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";
import type { TemplateSourceService } from "./TemplateSourceService.js";
import { runTemplateSetup, templateRuntime } from "./template-runtime.js";

export const templateCreationRequest = z.strictObject({
  operationId: z.string().uuid(),
  sourceId: z.string().min(1),
  templateId: z.string().min(1),
  path: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  intent: z.string().trim().min(1).max(100_000),
  stagedAttachments: z
    .object({
      batchId: z.string().min(1),
      refs: z
        .array(
          z.object({
            id: z.string(),
            batchId: z.string(),
            originalName: z.string(),
            name: z.string(),
            size: z.number().nonnegative(),
            mimeType: z.string(),
            width: z.number().optional(),
            height: z.number().optional(),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        )
        .max(100),
    })
    .optional(),
  session: z.record(z.string(), z.unknown()).default({}),
});
export type TemplateCreationRequest = z.infer<typeof templateCreationRequest>;
const operationSchema = z.object({
  request: templateCreationRequest,
  phase: z.enum([
    "materializing",
    "setup",
    "registering",
    "preparing",
    "started",
    "failed",
    "interrupted",
  ]),
  log: z.string(),
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
  ownerUsername: z.string().nullable().default(null),
});
export type TemplateCreationOperation = z.infer<typeof operationSchema>;
export interface TemplateCreationActions {
  ownerUsername?: string;
  authorize?: (path: string) => Promise<void>;
  register: (path: string, name: string) => Promise<string>;
  prepare: (
    projectId: string,
    message: string,
    settings: Record<string, unknown>,
  ) => Promise<string>;
}

/** Owns template creation across HTTP retries; interrupted side effects are never replayed. */
export class TemplateCreationService {
  private readonly directory: string;
  private admission: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly running = new Map<
    string,
    {
      state: TemplateCreationOperation;
      done: Promise<void>;
      controller: AbortController;
    }
  >();

  constructor(
    dataDir: string,
    private readonly sources: TemplateSourceService,
  ) {
    this.directory = join(dataDir, "project-template-operations");
  }

  private file(id: string): string {
    return join(this.directory, `${z.string().uuid().parse(id)}.json`);
  }

  async get(id: string): Promise<TemplateCreationOperation | null> {
    const running = this.running.get(id);
    if (running) return structuredClone(running.state);
    let state: TemplateCreationOperation;
    try {
      state = operationSchema.parse(
        JSON.parse(await readFile(this.file(id), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!["started", "failed", "interrupted"].includes(state.phase)) {
      state.error = `Creation was interrupted during ${state.phase}. The partial directory is retained. Inspect it and any preparation session before creating another project.`;
      state.phase = "interrupted";
    }
    return state;
  }

  async start(
    input: TemplateCreationRequest,
    actions: TemplateCreationActions,
  ): Promise<TemplateCreationOperation> {
    const admitted = this.admission.then(() => this.admit(input, actions));
    this.admission = admitted.catch(() => undefined);
    return admitted;
  }

  private async admit(
    input: TemplateCreationRequest,
    actions: TemplateCreationActions,
  ): Promise<TemplateCreationOperation> {
    if (this.closed) throw new Error("Template creation is shutting down");
    const request = templateCreationRequest.parse(input);
    const existing = await this.get(request.operationId);
    if (existing) {
      if (existing.ownerUsername !== (actions.ownerUsername ?? null))
        throw new Error("Operation not found");
      if (JSON.stringify(existing.request) !== JSON.stringify(request))
        throw new Error(
          "Template operation ID already belongs to a different request",
        );
      return existing;
    }
    if (this.running.size >= 4)
      throw new Error(
        "Too many template creations are running; wait for one to finish",
      );
    const library = await this.sources.creationLibrary();
    if (library.sourceOf(request.templateId) !== request.sourceId)
      throw new Error(
        "The selected template source changed; select the template again",
      );
    const composition = library.readyComposition(request.templateId);
    const runtime = templateRuntime(composition);
    const expanded = expandHomePath(request.path);
    if (!isAbsolute(expanded))
      throw new Error("Template project path must be absolute");
    const target = resolve(expanded);
    await actions.authorize?.(target);
    await mkdir(dirname(target), { recursive: true });
    const parent = await realpath(dirname(target));
    if (!(await stat(parent)).isDirectory())
      throw new Error("Template project parent is not a directory");
    const canonicalTarget = join(parent, basename(target));
    await actions.authorize?.(canonicalTarget);
    const state: TemplateCreationOperation = {
      request,
      phase: "materializing",
      log: "",
      ownerUsername: actions.ownerUsername ?? null,
    };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // Exclusive journal allocation arbitrates repeated concurrent requests before side effects.
    try {
      await writeFile(this.file(request.operationId), JSON.stringify(state), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const winner = await this.get(request.operationId);
      if (
        !winner ||
        winner.ownerUsername !== (actions.ownerUsername ?? null) ||
        JSON.stringify(winner.request) !== JSON.stringify(request)
      )
        throw new Error(
          "Template operation ID already belongs to a different request",
        );
      return winner;
    }
    const controller = new AbortController();
    let writes = Promise.resolve();
    const persist = () => {
      const bytes = JSON.stringify(state);
      writes = writes.then(() =>
        writeFileAtomically(this.file(request.operationId), bytes),
      );
      return writes;
    };
    const phase = async (next: TemplateCreationOperation["phase"]) => {
      state.phase = next;
      await persist();
    };
    const execute = async () => {
      try {
        await actions.authorize?.(canonicalTarget);
        await library.materialize(request.templateId, canonicalTarget, {
          name: request.name,
          description: request.intent,
        });
        await phase("setup");
        await actions.authorize?.(canonicalTarget);
        await runTemplateSetup(
          canonicalTarget,
          runtime.setup,
          (text) => {
            state.log = (state.log + text).slice(-64 * 1024);
          },
          controller.signal,
          !!actions.ownerUsername,
        );
        controller.signal.throwIfAborted();
        const bundle = await realpath(
          join(canonicalTarget, runtime.dir, "index.html"),
        );
        const bundleRelative = relative(canonicalTarget, bundle);
        if (
          bundleRelative.startsWith("..") ||
          isAbsolute(bundleRelative) ||
          !(await stat(bundle)).isFile()
        )
          throw new Error(
            "Template setup did not produce a contained starter index.html",
          );
        await initializeProjectGit(canonicalTarget, true);
        await phase("registering");
        controller.signal.throwIfAborted();
        await actions.authorize?.(canonicalTarget);
        state.projectId = await actions.register(canonicalTarget, request.name);
        await phase("preparing");
        controller.signal.throwIfAborted();
        await actions.authorize?.(canonicalTarget);
        const prompt = composition.files
          .get(runtime.prepare)!
          .content.toString("utf8");
        state.sessionId = await actions.prepare(
          state.projectId,
          `${prompt}\n\nProject name and intent (user data):\n${JSON.stringify({ name: request.name, intent: request.intent })}`,
          request.session,
        );
        await phase("started");
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        state.phase = controller.signal.aborted ? "interrupted" : "failed";
        await persist();
      }
    };
    const done = execute().finally(() =>
      this.running.delete(request.operationId),
    );
    this.running.set(request.operationId, { state, done, controller });
    void done.catch((error: unknown) =>
      console.error(
        "[TemplateCreation] Could not persist operation outcome",
        error,
      ),
    );
    return structuredClone(state);
  }

  async wait(id: string): Promise<void> {
    await this.running.get(id)?.done;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.admission;
    const operations = [...this.running.values()];
    for (const operation of operations) operation.controller.abort();
    await Promise.all(operations.map((operation) => operation.done));
  }
}
