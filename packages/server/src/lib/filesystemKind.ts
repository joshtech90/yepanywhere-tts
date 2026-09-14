import { statfsSync } from "node:fs";

/**
 * Why a directory is not plain local disk. Callers care about different
 * reasons, so the reason travels with the name rather than collapsing into one
 * "foreign" flag:
 *
 * - `network` means every file operation, including an advisory lock, is a
 *   round trip to another host.
 * - `memory` means the bytes are charged to RAM, so storing a table there
 *   pays for it twice.
 * - `userspace` means a FUSE driver, which says who implements the filesystem
 *   and not where the bytes live. A FUSE mount may be a local overlay or a
 *   remote share, so a caller that only fears the network must not treat this
 *   as one.
 */
export type FilesystemCategory = "network" | "memory" | "userspace";

export interface FilesystemKind {
  /** Short name for a log line or a user-facing notice, e.g. `NFS`. */
  name: string;
  category: FilesystemCategory;
}

/**
 * Linux reports these magic numbers in `statfs`. Other platforms report a type
 * this table does not name: macOS numbers its filesystems independently and
 * Windows has no equivalent, so a share there is classified as unknown rather
 * than guessed at. Unknown always means "treated as local disk", so a missing
 * entry costs a caller nothing it did not already have.
 */
const FILESYSTEM_KINDS = new Map<number, FilesystemKind>([
  [0x6969, { name: "NFS", category: "network" }],
  [0xff534d42, { name: "CIFS", category: "network" }],
  [0xfe534d42, { name: "SMB2", category: "network" }],
  [0x5346414f, { name: "AFS", category: "network" }],
  [0x01021997, { name: "9P", category: "network" }],
  [0x00c36400, { name: "Ceph", category: "network" }],
  [0x01161970, { name: "GFS2", category: "network" }],
  [0x7461636f, { name: "OCFS2", category: "network" }],
  [0x0bd00bd0, { name: "Lustre", category: "network" }],
  [0x01021994, { name: "tmpfs", category: "memory" }],
  [0x858458f6, { name: "ramfs", category: "memory" }],
  [0x65735546, { name: "FUSE", category: "userspace" }],
]);

export interface FilesystemFacts {
  /** Bytes an unprivileged writer may still use. */
  freeBytes: number;
  /** Absent when the filesystem is local disk or could not be identified. */
  kind?: FilesystemKind;
}

/** Throws when the directory cannot be inspected; callers decide what that means. */
export function statFilesystem(dir: string): FilesystemFacts {
  const stat = statfsSync(dir);
  const kind = FILESYSTEM_KINDS.get(Number(stat.type));
  return {
    freeBytes: Number(stat.bavail) * Number(stat.bsize),
    ...(kind ? { kind } : {}),
  };
}

/**
 * Name the network filesystem behind `dir`, or `undefined` when it is local
 * disk, another kind of foreign filesystem, or cannot be inspected at all. An
 * uninspectable directory is reported as local so a hardened container or an
 * unfamiliar platform loses no capability.
 */
export function networkFilesystemName(dir: string): string | undefined {
  try {
    const kind = statFilesystem(dir).kind;
    return kind?.category === "network" ? kind.name : undefined;
  } catch {
    return undefined;
  }
}
