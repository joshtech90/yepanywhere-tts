import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Scratch space is regenerable YA state that wants local disk rather than the
 * data directory: anything placed there can be rebuilt from the user's own
 * history, so a cache sweep or a reboot-cleared temporary directory loses no
 * durable answer. Nothing reserves such a directory today — speech vocabulary,
 * the one feature that did, keeps its files in the data directory now — so
 * this module names the places earlier versions could have chosen, for the
 * feature that has to find and adopt what it left there.
 */

/** Bytes with an optional binary K/M/G/T suffix, e.g. `256M`. */
export function parseByteSize(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgt])?(?:i?b)?\s*$/i.exec(value);
  if (!match) throw new Error(`Invalid byte size: ${value}`);
  const scale = { k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
  const suffix = match[2]?.toLowerCase() as keyof typeof scale | undefined;
  const bytes = Number(match[1]) * (suffix ? scale[suffix] : 1);
  if (!Number.isFinite(bytes) || bytes < 0)
    throw new Error(`Invalid byte size: ${value}`);
  return Math.floor(bytes);
}

function instanceSuffix(dataDir: string): string {
  return createHash("sha256").update(dataDir).digest("hex").slice(0, 12);
}

/**
 * Scratch directories a purpose could hold, newest choice first: the
 * `YEP_SCRATCH_DIR` override, the cache home, the temporary directory, then
 * the data directory itself as the last resort. The leaf carries a digest of
 * the data directory so two YA instances sharing one scratch root stay apart.
 * Naming a directory does not create it, so a caller may probe all four.
 */
export function scratchSpaceDirectories(
  purpose: string,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const leaf = `${purpose}-${instanceSuffix(dataDir)}`;
  const override = env.YEP_SCRATCH_DIR?.trim();
  const cacheHome = env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return [
    ...(override ? [join(override, leaf)] : []),
    join(cacheHome, "yep-anywhere", leaf),
    join(tmpdir(), "yep-anywhere", leaf),
    join(dataDir, purpose),
  ];
}
