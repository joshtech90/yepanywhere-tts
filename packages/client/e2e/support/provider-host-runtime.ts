import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { terminateRegisteredProcess } from "./process-lifecycle.js";
import type { OwnedProcess } from "./process-registry.js";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/**
 * Where a run keeps its private provider-host runtime state, given the run's
 * temporary directory. Global setup, the per-test servers, and global teardown
 * must name the same directory or each would own a different host.
 */
export function providerHostRuntimeDir(runTempDir: string): string {
  return join(runTempDir, "provider-host");
}

/**
 * A headless provider host outlives the YA server that started it: it detaches
 * into its own process group and only shuts down on a signal. Test servers get
 * a private runtime directory so they never collide with the developer's own
 * YA, which means nothing else will ever reclaim theirs. Terminate it through
 * the host's own recovery path, which signals the owner and its worker groups.
 */
export async function stopProviderHostRuntime(
  runtimeDir: string,
): Promise<void> {
  const failures: unknown[] = [];
  try {
    await recoverPublishedHost(runtimeDir);
  } catch (error) {
    failures.push(error);
  }
  // Receipts cover the detached startup window before descriptor publication.
  // The caller has already terminated the YA launcher, so it cannot add more.
  const launches = join(runtimeDir, "e2e-launches");
  if (existsSync(launches)) {
    const results = await Promise.allSettled(
      readdirSync(launches)
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const path = join(launches, file);
          const record = JSON.parse(
            readFileSync(path, "utf8"),
          ) as OwnedProcess & { pending?: boolean };
          if (
            record.pending ||
            !Number.isInteger(record.pid) ||
            record.pid <= 1
          )
            throw new Error(`Incomplete E2E host launch receipt at ${path}`);
          await terminateRegisteredProcess(
            record.pid,
            record.label,
            record.leaderStartTime,
          );
          rmSync(path);
        }),
    );
    for (const result of results)
      if (result.status === "rejected") failures.push(result.reason);
  }
  // A booting host can publish after the first descriptor read. Its final
  // descriptor still owns any workers even when the host leader is now gone.
  try {
    await recoverPublishedHost(runtimeDir);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `Could not reclaim E2E host in ${runtimeDir}`,
    );
}

async function recoverPublishedHost(runtimeDir: string): Promise<void> {
  if (!existsSync(join(runtimeDir, "host.json"))) return;
  try {
    const discovery = (await import(
      pathToFileURL(join(repoRoot, "scripts", "provider-runtime-discovery.mjs"))
        .href
    )) as {
      readProviderHostDescriptor: (paths: unknown) => unknown;
      recoverProviderHost: (
        paths: unknown,
        descriptor: unknown,
      ) => Promise<unknown>;
      resolveProviderHostPaths: (env: NodeJS.ProcessEnv) => unknown;
    };
    const paths = discovery.resolveProviderHostPaths({
      YEP_PROVIDER_HOST_RUNTIME_DIR: runtimeDir,
    });
    if (!paths) return;
    await discovery.recoverProviderHost(
      paths,
      discovery.readProviderHostDescriptor(paths),
    );
  } catch (error) {
    // A source-owned macOS host can finish IPC shutdown during this read.
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" &&
      !existsSync(join(runtimeDir, "host.json"))
    )
      return;
    throw new Error(`Could not stop E2E provider host in ${runtimeDir}`, {
      cause: error,
    });
  }
}
