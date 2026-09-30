import { isAbsolute } from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { z } from "zod";
import { ProjectServiceManager } from "./ProjectServiceManager.js";
import { captureProcessIdentity } from "../../../../scripts/provider-process-identity.mjs";

const requestSchema = z.discriminatedUnion("op", [
  z.object({ id: z.number(), op: z.literal("shutdown") }),
  z.object({
    id: z.number(),
    op: z.literal("authorize"),
    authorizationId: z.number(),
    error: z.string().optional(),
  }),
  z.object({
    id: z.number(),
    op: z.literal("service"),
    dataDir: z.string().refine(isAbsolute),
    action: z.enum([
      "start",
      "stop",
      "status",
      "upstream",
      "upstreamForToken",
      "ownsLaunch",
      "listUpstreams",
    ]),
    projectId: z.string().min(1),
    projectPath: z.string().optional(),
    mode: z.enum(["app", "live-preview"]).default("app"),
  }),
]);
const managers = new Map<string, ProjectServiceManager>();
const authorizations = new Map<
  number,
  { resolve: () => void; reject: (error: Error) => void }
>();
let nextAuthorization = 1;
let closing = false;

function authorize(id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const authorizationId = nextAuthorization++;
    const timer = setTimeout(() => {
      authorizations.delete(authorizationId);
      reject(new Error("App execution authorization timed out"));
    }, 15_000);
    authorizations.set(authorizationId, {
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    process.send?.({ id, type: "authorize", authorizationId });
  });
}

async function close(): Promise<void> {
  closing = true;
  for (const pending of authorizations.values())
    pending.reject(new Error("App owner is closing"));
  authorizations.clear();
  const results = await Promise.allSettled(
    [...managers.values()].map((manager) => manager.close()),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      "Apps failed to stop",
    );
}

async function handle(value: unknown): Promise<void> {
  const request = requestSchema.parse(value);
  if (request.op === "authorize") {
    const pending = authorizations.get(request.authorizationId);
    authorizations.delete(request.authorizationId);
    if (request.error) pending?.reject(new Error(request.error));
    else pending?.resolve();
    return;
  }
  try {
    if (request.op === "shutdown") {
      await close();
      process.send?.({ id: request.id, result: null }, () =>
        process.disconnect(),
      );
      return;
    }
    if (closing) throw new Error("App owner is closing");
    await mkdir(request.dataDir, { recursive: true, mode: 0o700 });
    const dataDir = await realpath(request.dataDir);
    let manager = managers.get(dataDir);
    if (!manager) {
      if (managers.size >= 32)
        throw new Error("App data-directory limit reached (32)");
      manager = new ProjectServiceManager(dataDir, "provider-host", (pid) => {
        const identity = captureProcessIdentity(pid);
        process.send?.({
          type: "processGroup",
          target: { processGroupId: pid, leaderStartTime: identity.startTime },
        });
        return () => {
          if (process.connected)
            process.send?.({ type: "processGroupClosed", pid });
        };
      });
      managers.set(dataDir, manager);
    }
    let result: unknown;
    switch (request.action) {
      case "start":
        if (!request.projectPath) throw new Error("Missing app project path");
        result = await manager.start(
          request.projectId,
          request.projectPath,
          () => authorize(request.id),
          request.mode,
        );
        break;
      case "stop":
        result = await manager.stop(request.projectId, () =>
          authorize(request.id),
        );
        break;
      case "status":
        result = await manager.status(request.projectId);
        break;
      case "upstream":
        result = manager.upstream(request.projectId);
        break;
      case "upstreamForToken":
        result = manager.upstreamForToken(request.projectId);
        break;
      case "ownsLaunch":
        result = manager.ownsLaunch(request.projectId);
        break;
      case "listUpstreams":
        result = manager.listUpstreams();
        break;
    }
    process.send?.({ id: request.id, result });
  } catch (error) {
    process.send?.({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (!process.send) throw new Error("App worker requires private parent IPC");
process.on("message", (value) => {
  void handle(value).catch((error) => {
    console.error("[ProjectServiceWorker] Invalid owner request", error);
    void close().finally(() => process.exit(1));
  });
});
process.on("disconnect", () => {
  void close().catch((error) => {
    console.error("[ProjectServiceWorker] Owner-loss cleanup failed", error);
    process.exitCode = 1;
  });
});
