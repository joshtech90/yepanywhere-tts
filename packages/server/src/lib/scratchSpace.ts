import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { statFilesystem } from "./filesystemKind.js";

/**
 * Home for regenerable YA state that wants local disk rather than the data
 * directory. The data directory is often a network mount, where a table that is
 * rewritten as work arrives costs far more than the same bytes on a local disk;
 * anything placed here can be rebuilt from the user's own history, so a cache
 * sweep or a reboot-cleared temporary directory loses no durable answer.
 */
export interface ScratchSpace {
  /** Directory this purpose owns. Created by the reservation. */
  dir: string;
  /** Bytes the caller may spend there. Never above the request. */
  bytes: number;
  /** What the caller asked for, so a smaller grant can be reported. */
  requested: number;
  /** No candidate looked like local disk with room to spare. */
  degraded: boolean;
  /** One line naming the chosen directory and why, for a startup log. */
  reason: string;
}

/**
 * Free space a candidate keeps after the reservation. A cache or temporary
 * directory is shared with the rest of the machine, so filling it to the brim
 * for an optional feature is not acceptable behavior.
 */
const HEADROOM_BYTES = 1024 * 1024 * 1024;

export interface ReserveScratchSpaceOptions {
  /** Short name of the feature that owns the directory, e.g. `speech-vocabulary`. */
  purpose: string;
  /** Bytes the caller wants available. */
  bytes: number;
  /** Data directory, used to keep instances apart and as the last resort. */
  dataDir: string;
  /** Smallest useful grant; the caller gets at least this even when space is tight. */
  minimumBytes?: number;
  env?: NodeJS.ProcessEnv;
}

interface Candidate {
  dir: string;
  label: string;
  /** Chosen even when it is a network mount, because nothing else is left. */
  lastResort?: boolean;
}

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

function candidates(
  options: ReserveScratchSpaceOptions,
  env: NodeJS.ProcessEnv,
): Candidate[] {
  const leaf = `${options.purpose}-${instanceSuffix(options.dataDir)}`;
  const override = env.YEP_SCRATCH_DIR?.trim();
  const cacheHome = env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return [
    ...(override
      ? [{ dir: join(override, leaf), label: "YEP_SCRATCH_DIR" }]
      : []),
    { dir: join(cacheHome, "yep-anywhere", leaf), label: "cache directory" },
    { dir: join(tmpdir(), "yep-anywhere", leaf), label: "temporary directory" },
    {
      dir: join(options.dataDir, options.purpose),
      label: "data directory",
      lastResort: true,
    },
  ];
}

/**
 * Every kind this module can name defeats the purpose of scratch space: a
 * network mount is slower than the data directory it was meant to escape, a
 * memory-backed one charges the reservation to RAM twice, and a FUSE mount is
 * either of those wearing a userspace driver.
 */
function freeBytes(dir: string): { free: number; foreign?: string } {
  const facts = statFilesystem(dir);
  return {
    free: facts.freeBytes,
    ...(facts.kind ? { foreign: facts.kind.name } : {}),
  };
}

/**
 * Pick a directory for `purpose` and say how much of the request it can hold.
 * Candidates are tried in order and the first local one with room wins. When
 * none has room the roomiest is used with a reduced grant, so the caller
 * degrades to a smaller table instead of failing to start.
 */
export function reserveScratchSpace(
  options: ReserveScratchSpaceOptions,
): ScratchSpace {
  const env = options.env ?? process.env;
  const minimum = options.minimumBytes ?? 0;
  let best: { candidate: Candidate; free: number; note: string } | undefined;
  for (const candidate of candidates(options, env)) {
    let free: number;
    let note: string;
    try {
      mkdirSync(candidate.dir, { recursive: true });
      const space = freeBytes(candidate.dir);
      free = space.free;
      note = space.foreign ? `${candidate.label} is ${space.foreign}` : "";
      if (space.foreign && !candidate.lastResort) continue;
    } catch {
      // An unusable candidate is ordinary: no cache home, a read-only
      // temporary directory, a container without the mount. Try the next.
      continue;
    }
    if (free - options.bytes >= HEADROOM_BYTES) {
      return {
        dir: candidate.dir,
        bytes: options.bytes,
        requested: options.bytes,
        degraded: Boolean(note),
        reason: note
          ? `${candidate.dir} (${note})`
          : `${candidate.dir} (${candidate.label})`,
      };
    }
    if (!best || free > best.free) best = { candidate, free, note };
  }
  if (!best)
    throw new Error(
      `No usable directory for ${options.purpose}; set YEP_SCRATCH_DIR`,
    );
  const granted = Math.max(
    minimum,
    Math.min(options.bytes, best.free - HEADROOM_BYTES),
  );
  return {
    dir: best.candidate.dir,
    bytes: granted,
    requested: options.bytes,
    degraded: true,
    reason: `${best.candidate.dir} (${best.note || `${best.candidate.label} has ${Math.floor(best.free / 1024 ** 2)} MB free`})`,
  };
}
