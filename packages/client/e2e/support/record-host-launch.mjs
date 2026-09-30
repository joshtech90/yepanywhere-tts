// @ts-check
/** Observe real host launches without replacing their runtime or lifetime. */
import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProcessIdentity } from "../../../../scripts/provider-process-identity.mjs";

const hostEntrypoint = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../scripts/provider-runtime-host.mjs",
);
const spawn = childProcess.spawn;
/**
 * @returns {import("node:child_process").ChildProcess}
 * @param {string} command
 * @param {readonly string[] | import("node:child_process").SpawnOptions} [args]
 * @param {import("node:child_process").SpawnOptions} [options]
 */
function observedSpawn(command, args, options) {
  const argumentsArray = Array.isArray(args) ? args : undefined;
  const runtimeDir = options?.env?.YEP_PROVIDER_HOST_RUNTIME_DIR;
  if (!runtimeDir || argumentsArray?.[0] !== hostEntrypoint)
    return Reflect.apply(spawn, childProcess, [command, args, options]);

  const directory = join(runtimeDir, "e2e-launches");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${randomUUID()}.json`);
  /** @param {Record<string, unknown>} record */
  const write = (record) => {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
    renameSync(temporary, file);
  };
  // This marker precedes spawn itself: a crash before identity publication
  // cannot make descriptor absence look like successful reclamation.
  write({ pending: true, label: "E2E provider host launch" });
  let child;
  try {
    child = spawn(command, argumentsArray, options ?? {});
  } catch (error) {
    rmSync(file, { force: true }); // No child was created.
    throw error;
  }
  child.on("error", () => {});
  if (!child.pid) {
    // Spawn failed before acquiring a process; the normal caller reports it.
    rmSync(file, { force: true });
    return child;
  }
  try {
    const identity = captureProcessIdentity(child.pid);
    write({
      pid: child.pid,
      leaderStartTime: identity.startTime,
      label: "E2E provider host launch",
    });
  } catch (error) {
    // The live handle proves ownership. Leave the pending marker if capture
    // or persistence failed so coordinator cleanup cannot silently succeed.
    try {
      child.kill("SIGKILL");
    } catch {}
    throw error;
  }
  return child;
}
childProcess.spawn = /** @type {typeof spawn} */ (observedSpawn);
syncBuiltinESMExports();
