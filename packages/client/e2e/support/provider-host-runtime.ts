import { existsSync } from "node:fs";
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
    console.warn(
      `[E2E] Could not stop provider host in ${runtimeDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
