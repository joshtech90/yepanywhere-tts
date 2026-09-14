import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { quoteShellWord } from "../utils/posixShell.js";
import {
  AGENT_SELF_PATH,
  type AgentSelfErrorCode,
  type AgentSelfReport,
} from "./protocol.js";

const MAX_LEASES = 1024;
const LEASE_LIFETIME_MS = 24 * 60 * 60 * 1000;
interface Entry {
  expiresAt: number;
  snapshot: () => AgentSelfReport | null;
}
interface Runtime {
  server: Server;
  directory: string;
  baseUrl: string;
  entries: Map<string, Entry>;
  closing: boolean;
}
let runtimePromise: Promise<Runtime> | undefined;

async function createRuntime(): Promise<Runtime> {
  const directory = await mkdtemp(join(tmpdir(), "ya-agent-tools-"));
  const entries = new Map<string, Entry>();
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    const fail = (status: number, code: AgentSelfErrorCode) => {
      response.writeHead(status);
      response.end(JSON.stringify({ schemaVersion: 1, error: { code } }));
    };
    if (request.method !== "GET" || request.url !== AGENT_SELF_PATH) {
      fail(404, "unsupported-protocol");
      return;
    }
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const entry = entries.get(token);
    if (!entry) return fail(401, "unauthorized");
    if (Date.now() >= entry.expiresAt) return fail(401, "expired");
    let report: AgentSelfReport | null;
    try {
      report = entry.snapshot();
    } catch {
      return fail(503, "owner-unavailable");
    }
    if (!report) return fail(409, "session-not-ready");
    if (
      request.headers["x-agent-session-id"] !== undefined &&
      request.headers["x-agent-session-id"] !== report.sessionId
    ) {
      return fail(403, "session-mismatch");
    }
    response.end(JSON.stringify(report));
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 16;
  server.maxConnections = 32;
  server.keepAliveTimeout = 1000;
  try {
    const source = import.meta.url.endsWith(".ts");
    const entry = join(
      dirname(fileURLToPath(import.meta.url)),
      source ? "cli.ts" : "cli.js",
    );
    const args =
      source && !process.versions.bun
        ? [
            "--import",
            pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
            entry,
          ]
        : [entry];
    const command = [process.execPath, ...args];
    if (process.platform === "win32") {
      const quoted = command
        .map((part) => `"${part.replaceAll("%", "%%")}"`)
        .join(" ");
      await writeFile(
        join(directory, "ya-agent.cmd"),
        `@echo off\r\n${quoted} %*\r\n`,
        { mode: 0o700 },
      );
    } else {
      await writeFile(
        join(directory, "ya-agent"),
        `#!/bin/sh\nexec ${command.map(quoteShellWord).join(" ")} "$@"\n`,
        { mode: 0o700 },
      );
    }
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.unref();
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Invalid agent service address");
    return {
      server,
      directory,
      entries,
      closing: false,
      baseUrl: `http://127.0.0.1:${address.port}`,
    };
  } catch (error) {
    server.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export interface AgentSelfLease {
  launchId: string;
  environment: Record<string, string>;
  dispose(): Promise<void>;
}

/** One listener/bin per provider-owner process, no polling or per-session timers. */
export async function createAgentSelfLease(
  snapshot: (launchId: string) => AgentSelfReport | null,
): Promise<AgentSelfLease> {
  runtimePromise ??= createRuntime();
  const pending = runtimePromise;
  let runtime: Runtime;
  try {
    runtime = await pending;
  } catch (error) {
    if (runtimePromise === pending) runtimePromise = undefined;
    throw error;
  }
  if (runtime.closing) return createAgentSelfLease(snapshot);
  if (runtime.entries.size >= MAX_LEASES)
    throw new Error("Agent self capacity exceeded");
  const token = randomBytes(32).toString("hex");
  const launchId = randomUUID();
  runtime.entries.set(token, {
    expiresAt: Date.now() + LEASE_LIFETIME_MS,
    snapshot: () => snapshot(launchId),
  });
  return {
    launchId,
    environment: {
      PATH: `${runtime.directory}${delimiter}${process.env.PATH ?? ""}`,
      AGENT_YA_API_URL: runtime.baseUrl,
      AGENT_YA_API_TOKEN: token,
    },
    async dispose() {
      if (!runtime.entries.delete(token)) return;
      if (runtime.entries.size !== 0) return;
      runtime.closing = true;
      if (runtimePromise === pending) runtimePromise = undefined;
      runtime.server.closeAllConnections();
      await new Promise<void>((resolve) =>
        runtime.server.close(() => resolve()),
      );
      await rm(runtime.directory, { recursive: true, force: true });
    },
  };
}
