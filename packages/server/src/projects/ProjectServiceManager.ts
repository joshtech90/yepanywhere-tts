import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  projectServiceSchema,
  type ProjectServiceDeclaration,
} from "@yep-anywhere/shared";
import { z } from "zod";
import { isPathInsideDirectory } from "../routes/local-resource-policy.js";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";
import { ProjectServiceProcess } from "./ProjectServiceProcess.js";

export const projectServiceRecordSchema = z.strictObject({
  generation: z.string().uuid(),
  declaration: projectServiceSchema,
  desired: z.enum(["running", "stopped"]),
  observed: z.enum(["starting", "running", "stopping", "stopped", "failed"]),
  updatedAt: z.string(),
  error: z.string().optional(),
  mode: z.enum(["app", "live-preview"]).default("app"),
  owner: z.enum(["server", "provider-host"]).default("server"),
});
type ServiceRecord = z.infer<typeof projectServiceRecordSchema>;
export type ProjectServices = {
  [K in keyof ProjectServiceManager]: ProjectServiceManager[K] extends (
    ...args: infer A
  ) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : ProjectServiceManager[K];
};
type LiveService = {
  record: ServiceRecord;
  process: ProjectServiceProcess;
  token: string;
  basePath: string;
};

export interface ProjectServiceUpstream {
  projectId: string;
  port: number;
  brokerSocket: string;
  generation: string;
  token: string;
  basePath: string;
  entry: string;
}

/** Source files are untrusted and bounded; neither discovery nor status executes them. */
export async function readProjectService(
  projectPath: string,
  mode: "app" | "live-preview" = "app",
): Promise<ProjectServiceDeclaration | null> {
  const root = await realpath(projectPath);
  let file: string;
  try {
    file = await realpath(join(root, ".project-template/app.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!isPathInsideDirectory(file, root))
    throw new Error("Service declaration escapes project");
  const handle = await open(file, "r");
  try {
    if (!(await handle.stat()).isFile())
      throw new Error("Service declaration must be a regular file");
    const bytes = Buffer.alloc(64 * 1024 + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead === bytes.length)
      throw new Error("Service declaration exceeds 64 KiB");
    const value = z
      .object({
        service: projectServiceSchema.optional(),
        livePreview: projectServiceSchema
          .refine(
            (service) => service.where.kind === "process",
            "Live preview requires a process",
          )
          .optional(),
        kind: z.string().optional(),
        dir: z.string().optional(),
      })
      .parse(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")));
    if (mode === "live-preview") return value.livePreview ?? null;
    // Existing canvas templates have an explicit static output directory.
    // Adapt that declaration only; never infer executable server commands.
    if (!value.service && value.kind === "static" && value.dir)
      return projectServiceSchema.parse({
        version: 1,
        where: { kind: "static", root: value.dir, entry: "index.html" },
        serving: { target: "static-root" },
      });
    return value.service ?? null;
  } finally {
    await handle.close();
  }
}

/** One bounded, sandboxed launch per project, with restart-safe observed state. */
export class ProjectServiceManager {
  private readonly live = new Map<string, LiveService>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private closed = false;
  private readonly directory: string;

  constructor(
    private readonly dataDir: string,
    private readonly owner: "server" | "provider-host" = "server",
    private readonly onSpawn?: (pid: number) => () => void,
  ) {
    this.directory = join(dataDir, "project-services");
  }

  private file(projectId: string): string {
    return join(
      this.directory,
      `${createHash("sha256").update(projectId).digest("hex")}.json`,
    );
  }

  private async save(projectId: string, service: LiveService): Promise<void> {
    const record = {
      ...service.record,
      observed: service.process.state,
      error: service.process.error,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFileAtomically(this.file(projectId), JSON.stringify(record));
    service.record = record;
  }

  async status(projectId: string): Promise<ServiceRecord | null> {
    const live = this.live.get(projectId);
    if (live)
      return {
        ...live.record,
        observed: live.process.state,
        error: live.process.error,
      };
    try {
      const saved = projectServiceRecordSchema.parse(
        JSON.parse(await readFile(this.file(projectId), "utf8")),
      );
      if (["starting", "running", "stopping"].includes(saved.observed)) {
        if (saved.owner === "provider-host" && this.owner === "server")
          return {
            ...saved,
            observed: "failed",
            error:
              "App belongs to the provider host; enable hosting to inspect or stop it",
          };
        return {
          ...saved,
          observed: "stopped",
          error:
            "Service interrupted by YA restart; start explicitly to launch again",
        };
      }
      return saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  upstream(projectId: string): ProjectServiceUpstream | null {
    const live = this.live.get(projectId);
    const brokerSocket = live?.process.brokerSocket;
    return live && brokerSocket
      ? {
          projectId,
          port: live.process.port,
          brokerSocket,
          generation: live.record.generation,
          token: live.token,
          basePath: live.basePath,
          entry: live.record.declaration.where.entry,
        }
      : null;
  }

  ownsLaunch(projectId: string): boolean {
    return this.live.has(projectId);
  }

  listUpstreams(): ProjectServiceUpstream[] {
    return [...this.live.keys()].flatMap((projectId) => {
      const upstream = this.upstream(projectId);
      return upstream ? [upstream] : [];
    });
  }

  upstreamForToken(token: string): ProjectServiceUpstream | null {
    for (const [projectId, service] of this.live)
      if (service.token === token) return this.upstream(projectId);
    return null;
  }

  private serial<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const prior = this.operations.get(projectId) ?? Promise.resolve();
    const current = prior.then(operation, operation);
    this.operations.set(projectId, current);
    void current
      .finally(() => {
        if (this.operations.get(projectId) === current)
          this.operations.delete(projectId);
      })
      .catch(() => {}); // The request owns the error; this observer only releases its queue slot.
    return current;
  }

  start(
    projectId: string,
    projectPath: string,
    authorize: () => Promise<void>,
    mode: "app" | "live-preview" = "app",
  ): Promise<ServiceRecord> {
    return this.serial(projectId, async () => {
      if (this.closed) throw new Error("Project services are shutting down");
      await authorize();
      const saved = await this.status(projectId);
      if (
        saved?.owner === "provider-host" &&
        this.owner === "server" &&
        saved.desired === "running"
      )
        throw new Error(
          "App belongs to the provider host; enable hosting before starting another app",
        );
      const previous = this.live.get(projectId);
      if (
        previous?.process.state === "running" &&
        previous.record.mode === mode
      )
        return (await this.status(projectId))!;
      const declaration = await readProjectService(projectPath, mode);
      if (!declaration || !("start" in declaration))
        throw new Error(
          "Project has no process service declaration for this mode",
        );
      if (previous?.process.state === "running")
        throw new Error("Stop the current app before changing preview mode");
      // A failed stop still owns its process: retry termination before any replacement.
      if (previous) await previous.process.stop();
      await authorize();
      if (this.closed) throw new Error("Project services are shutting down");
      if (!previous && this.live.size >= 32)
        throw new Error("Project service limit reached (32)");
      const token = randomBytes(24).toString("hex");
      const basePath = declaration.serving.basePathEnv ? `/p/${token}/` : "";
      const service: LiveService = {
        token,
        basePath,
        record: {
          owner: this.owner,
          mode,
          generation: randomUUID(),
          declaration,
          desired: "running",
          observed: "starting",
          updatedAt: new Date().toISOString(),
        },
        process: new ProjectServiceProcess(
          {
            projectPath,
            cwd: declaration.where.cwd,
            argv: declaration.start.argv,
            portEnv: declaration.start.portEnv,
            readyPath: basePath
              ? `${basePath}${declaration.status.path.slice(1)}`
              : declaration.status.path,
            readyStatus: declaration.status.readyStatus,
            startupTimeoutMs: declaration.status.startupTimeoutMs,
            stopGraceMs: declaration.stop.graceMs,
            sandboxStateRoot: join(this.dataDir, "session-sandboxes"),
            basePath: declaration.serving.basePathEnv
              ? { env: declaration.serving.basePathEnv, value: basePath }
              : undefined,
          },
          this.onSpawn,
        ),
      };
      this.live.set(projectId, service);
      try {
        await this.save(projectId, service);
      } catch (error) {
        this.live.delete(projectId);
        throw error;
      }
      try {
        await service.process.start();
      } finally {
        await this.save(projectId, service);
      }
      return (await this.status(projectId))!;
    });
  }

  stop(
    projectId: string,
    authorize: () => Promise<void>,
  ): Promise<ServiceRecord | null> {
    return this.serial(projectId, async () => {
      await authorize();
      const service = this.live.get(projectId);
      if (!service) {
        const saved = await this.status(projectId);
        if (!saved) return null;
        if (
          saved.owner === "provider-host" &&
          this.owner === "server" &&
          saved.desired === "running"
        )
          throw new Error("Enable provider hosting to stop its app");
        const stopped = {
          ...saved,
          desired: "stopped" as const,
          updatedAt: new Date().toISOString(),
        };
        await writeFileAtomically(
          this.file(projectId),
          JSON.stringify(stopped),
        );
        return stopped;
      }
      service.record.desired = "stopped";
      try {
        await service.process.stop();
      } finally {
        await this.save(projectId, service);
      }
      this.live.delete(projectId);
      return this.status(projectId);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.operations.values());
    const stopped = await Promise.allSettled(
      [...this.live.keys()].map((projectId) =>
        this.stop(projectId, async () => {}),
      ),
    );
    const errors = stopped
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length)
      throw new AggregateError(errors, "Project services failed to stop");
  }
}

export async function projectServiceStaticEntry(
  projectPath: string,
  declaration: ProjectServiceDeclaration,
): Promise<string> {
  return (await projectServiceStaticApp(projectPath, declaration)).entry;
}

export async function projectServiceStaticApp(
  projectPath: string,
  declaration: ProjectServiceDeclaration,
): Promise<{ entry: string; root: string }> {
  if (declaration.where.kind !== "static")
    throw new Error("Expected a static app");
  const root = await realpath(projectPath);
  const servingRoot = await realpath(resolve(root, declaration.where.root));
  const entry = await realpath(resolve(servingRoot, declaration.where.entry));
  if (
    (servingRoot !== root && !isPathInsideDirectory(servingRoot, root)) ||
    !isPathInsideDirectory(entry, servingRoot)
  )
    throw new Error("Static app escapes project");
  return { entry, root: servingRoot };
}
