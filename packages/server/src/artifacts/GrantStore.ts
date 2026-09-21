import {
  mkdir,
  readdir,
  readFile,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runGit } from "../git/gitExec.js";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";

/**
 * Durable artifact grants and the deletions they owe.
 *
 * A link that says it expires in seven days has to survive a restart to be
 * true, so the grant table is a file rather than process memory. That file
 * holds live bearer tokens: anyone who can read it holds every unexpired
 * artifact URL, which is why its directory is created mode 700 and why no
 * artifact content is ever written here.
 */

export interface StoredGrant {
  id: string;
  token: string;
  root: string;
  entry: string;
  expiresAt: number;
  /** An owning grant deletes its directory when it expires or is revoked. */
  owned: boolean;
  /**
   * The files that were in the directory when the grant was created, relative
   * to its root. Ownership covers exactly these: anything added afterwards
   * belongs to whoever put it there.
   */
  ownedFiles?: string[];
}

export interface PendingDeletion {
  root: string;
  /** The frozen fileset, relative to root. */
  files: string[];
  dueAt: number;
}

interface StoredState {
  version: 1;
  grants: StoredGrant[];
  deletions: PendingDeletion[];
}

const EMPTY: StoredState = { version: 1, grants: [], deletions: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readGrant(value: unknown): StoredGrant | null {
  if (!isRecord(value)) return null;
  const { id, token, root, entry, expiresAt, owned } = value;
  if (
    typeof id !== "string" ||
    typeof token !== "string" ||
    typeof root !== "string" ||
    typeof entry !== "string" ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt)
  )
    return null;
  return {
    id,
    token,
    root,
    entry,
    expiresAt,
    owned: owned === true,
    ownedFiles: readFileset((value as Record<string, unknown>).ownedFiles),
  };
}

function readFileset(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((name): name is string => typeof name === "string");
}

function readDeletion(value: unknown): PendingDeletion | null {
  if (!isRecord(value)) return null;
  const { root, dueAt } = value;
  if (typeof root !== "string" || typeof dueAt !== "number") return null;
  return { root, files: readFileset(value.files) ?? [], dueAt };
}

const has = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * The working tree `path` sits in, or null.
 *
 * `.git` is a directory in an ordinary clone and a file in a linked worktree
 * or a submodule, so its kind says nothing; that it is there at all does.
 */
export async function enclosingWorkingTree(
  path: string,
): Promise<string | null> {
  for (let directory = resolve(path); ; directory = dirname(directory)) {
    if (await has(join(directory, ".git"))) return directory;
    if (directory === dirname(directory)) return null;
  }
}

/**
 * The paths Git tracks under `root`, relative to it, or null when Git cannot
 * say. A staged-but-uncommitted file counts as tracked: it was added.
 */
async function trackedFiles(root: string): Promise<Set<string> | null> {
  return runGit(root, ["ls-files", "-z", "--cached", "--", "."], {
    maxBuffer: 8 * 1024 * 1024,
  }).then(
    ({ stdout }) => new Set(stdout.split("\0").filter(Boolean)),
    () => null,
  );
}

/**
 * Directories that are never a disposable artifact bundle, whatever a caller
 * claims: a working tree's own root, a home directory, YA's own state, and
 * anything holding one of those.
 *
 * Inside a working tree the location is not the evidence — a capture written
 * to `<checkout>/.artifacts/` is still the caller's to clean up — because
 * {@link GrantStore.freeze} keeps only files Git does not track, so published
 * user content is excluded file by file. Outside every working tree there is
 * no such evidence, and a directory under a home directory or under YA's state
 * is ordinary content that happened to be published; `~/Downloads` is the case
 * that would otherwise cost a user their files.
 */
export async function deletableDirectory(
  root: string,
  forbidden: readonly (string | undefined)[],
): Promise<boolean> {
  const path = resolve(root);
  if (path === dirname(path)) return false;
  // The root of a checkout is the checkout, not a bundle inside one.
  if (await has(join(path, ".git"))) return false;
  const tracked = (await enclosingWorkingTree(path)) !== null;
  for (const other of [...forbidden, homedir()]) {
    if (!other) continue;
    const compare = resolve(other);
    if (path === compare || compare.startsWith(`${path}/`)) return false;
    if (!tracked && path.startsWith(`${compare}/`)) return false;
  }
  return true;
}

export class GrantStore {
  private state: StoredState = { ...EMPTY, grants: [], deletions: [] };
  private writing: Promise<void> = Promise.resolve();
  constructor(private readonly directory?: string) {}

  private get file(): string | undefined {
    return this.directory ? join(this.directory, "grants.json") : undefined;
  }

  /**
   * Read saved state. Corrupt or unreadable state is discarded rather than
   * blocking startup: the cost is that outstanding links stop working, which
   * is what every restart used to do anyway.
   */
  async load(): Promise<StoredState> {
    const file = this.file;
    if (!file) return { ...EMPTY, grants: [], deletions: [] };
    const raw = await readFile(file, "utf8").catch(() => null);
    if (raw === null) return { ...EMPTY, grants: [], deletions: [] };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("not an object");
      const grants = Array.isArray(parsed.grants)
        ? parsed.grants.map(readGrant).filter((g): g is StoredGrant => !!g)
        : [];
      const deletions = Array.isArray(parsed.deletions)
        ? parsed.deletions
            .map(readDeletion)
            .filter((d): d is PendingDeletion => !!d)
        : [];
      this.state = { version: 1, grants, deletions };
    } catch {
      this.state = { ...EMPTY, grants: [], deletions: [] };
    }
    return this.state;
  }

  /** Replace the saved state; writes are serialized and atomic. */
  save(grants: readonly StoredGrant[], deletions: readonly PendingDeletion[]) {
    this.state = { version: 1, grants: [...grants], deletions: [...deletions] };
    const file = this.file;
    if (!file) return this.writing;
    const snapshot = JSON.stringify(this.state);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory!, { recursive: true, mode: 0o700 });
        await writeFileAtomically(file, `${snapshot}\n`);
      });
    return this.writing;
  }

  /** Wait for the last write, so a caller can observe what is on disk. */
  settled(): Promise<void> {
    return this.writing.catch(() => {});
  }

  /**
   * Remove exactly the frozen fileset, then the directories it emptied.
   *
   * A grant owns the files that were there when it was created, not the
   * directory forever: anything written afterwards is someone else's, and a
   * directory that still holds something is left standing. A failure is
   * reported, never retried forever.
   */
  static async deleteFrozen(
    root: string,
    files: readonly string[],
  ): Promise<boolean> {
    let complete = true;
    const directories = new Set<string>();
    for (const name of files) {
      const path = join(root, name);
      // A stored name is relative and was produced by the walk below; refuse
      // anything that would climb out of the directory it belongs to.
      if (!resolve(path).startsWith(`${resolve(root)}/`)) {
        complete = false;
        continue;
      }
      const removed = await unlink(path).then(
        () => true,
        (error: NodeJS.ErrnoException) => error.code === "ENOENT",
      );
      if (!removed) complete = false;
      for (let parent = dirname(path); parent.startsWith(resolve(root)); )
        if (directories.add(parent)) parent = dirname(parent);
        else break;
    }
    // Deepest first, so a nested directory can empty its parent.
    for (const directory of [...directories, resolve(root)].sort(
      (a, b) => b.length - a.length,
    ))
      await rmdir(directory).catch(() => {});
    return complete;
  }

  /**
   * The files an owning grant may later remove, relative to `root`, or null
   * when it may remove none.
   *
   * Two things are excluded. Git metadata and anything Git tracks under this
   * root belongs to the working tree, not to the grant: a capture written
   * beside a checkout's own files may take itself away and must leave them.
   * Tracked-ness is read once, here; a file added to the index afterwards is
   * still in the fileset, and is recoverable from that index. A directory with
   * more files than the cap is not an artifact bundle, and one whose files are
   * all the working tree's own leaves the grant nothing to own, so both refuse
   * ownership rather than guess at it. So does a Git that will not answer.
   */
  static async freeze(root: string, cap = 4096): Promise<string[] | null> {
    const found: string[] = [];
    const walk = async (
      directory: string,
      prefix: string,
    ): Promise<boolean> => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        if (entry.name === ".git") continue;
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!(await walk(join(directory, entry.name), name))) return false;
        } else if (entry.isFile()) {
          if (found.length >= cap) return false;
          found.push(name);
        }
      }
      return true;
    };
    if (!(await walk(root, ""))) return null;
    if (!(await enclosingWorkingTree(root))) return found.length ? found : null;
    const tracked = await trackedFiles(root);
    if (!tracked) return null;
    const ours = found.filter((name) => !tracked.has(name));
    return ours.length ? ours : null;
  }
}
