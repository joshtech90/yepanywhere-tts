/** Runtime identity is diagnostic; it never implies SQLite storage readiness. */
export interface ServerRuntimeInfo {
  kind: "node" | "bun" | "unknown";
  version: string | null;
}

export const SERVER_NODE_RANGE = "^22.16 || ^23.11 || >=24.10";
export const SERVER_BUN_RANGE = ">=1.3.14";

/** Parse released semver, rejecting prereleases just as the engine ranges do. */
function releaseVersion(value: string): [number, number, number] | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!parts.every(Number.isSafeInteger)) return null;
  return parts as [number, number, number];
}

export function getServerRuntime(versions: {
  node?: string;
  bun?: string;
}): ServerRuntimeInfo {
  if (versions.bun !== undefined)
    return { kind: "bun", version: versions.bun || null };
  if (versions.node !== undefined)
    return { kind: "node", version: versions.node || null };
  return { kind: "unknown", version: null };
}

/** Exact released-version semantics of the two fixed ranges above. */
export function isSupportedServerRuntime(runtime: ServerRuntimeInfo): boolean {
  const version = runtime.version && releaseVersion(runtime.version);
  if (!version) return false;
  const [major, minor, patch] = version;
  if (runtime.kind === "bun") {
    return (
      major > 1 || (major === 1 && (minor > 3 || (minor === 3 && patch >= 14)))
    );
  }
  if (runtime.kind !== "node") return false;
  return (
    (major === 22 && minor >= 16) ||
    (major === 23 && minor >= 11) ||
    (major === 24 && minor >= 10) ||
    major >= 25
  );
}
