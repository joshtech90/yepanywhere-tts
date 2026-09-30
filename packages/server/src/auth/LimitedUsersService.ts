/**
 * LimitedUsersService owns the limited-user records: the second class of
 * principal beside the single superuser.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Settings → Users.
 *
 * Each record carries both credential forms for the one password: a bcrypt
 * hash for the direct cookie login and an SRP salt/verifier for the relay
 * login, where the username is the SRP identity. Neither form leaves this
 * service except as the SRP challenge inputs the handshake needs.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import bcrypt from "bcrypt";
import { z } from "zod";
import {
  type LimitedUserGrants,
  type LimitedUserLock,
  type LimitedUserSummary,
  type TemplateCreationGrant,
  templateGrantFor,
  clampJoinStaleOffsetMinutes,
  limitedUserPasswordError,
  limitedUsernameError,
  instructionBlocksError,
  MAX_PATH_GRANTS,
  type PathGrant,
  type ProjectAccessLevel,
} from "@yep-anywhere/shared";
import { deriveDecoySalt, generateVerifier } from "../crypto/srp-server.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import { createCoalescingSaver } from "../lib/coalescingSaver.js";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";
import {
  encodeProjectId,
  limitedDetachedProjectPath,
} from "../projects/paths.js";
import {
  OWNER_READ_WRITE_FILE_MODE,
  enforceOwnerReadWriteFilePermissions,
} from "../utils/filePermissions.js";

const BCRYPT_ROUNDS = 12;
const CURRENT_VERSION = 2;
const templateGrantSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("none") }),
  z.strictObject({ mode: z.literal("any") }),
  z.strictObject({
    mode: z.literal("selected"),
    templates: z
      .array(
        z.strictObject({
          sourceId: z.string().min(1),
          templateId: z.string().min(1),
        }),
      )
      .max(1000),
  }),
]);

export interface LimitedUserRecord extends LimitedUserGrants {
  username: string;
  passwordHash: string;
  srp: { salt: string; verifier: string };
  disabled?: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

interface LimitedUsersState {
  version: number;
  /**
   * What an unknown identity's SRP challenge is computed from: a salt derived
   * per identity from `secret`, and one verifier. The verifier never reaches
   * the client, so sharing it discloses nothing; the salt does, so it varies.
   */
  decoySrp?: { secret: string; verifier: string };
  users: Record<string, LimitedUserRecord>;
}

export interface LimitedUserInput {
  username: string;
  password?: string;
  newSessionProjects?: string[];
  joinProjects?: string[];
  viewProjects?: string[];
  joinStaleOffsetMinutes?: number;
  lock?: LimitedUserLock;
  projectRoot?: string;
  allowNoProjectSessions?: boolean;
  allowPublicApps?: boolean;
  allowPrivateAppLinks?: boolean;
  templateCreation?: TemplateCreationGrant;
  instructionBlocks?: string[];
  pathGrants?: PathGrant[];
  disabled?: boolean;
}

const pathGrantsSchema = z
  .array(
    z.strictObject({
      path: z.string().trim().min(1),
      level: z.enum(["view", "join", "new-session"]),
    }),
  )
  .max(MAX_PATH_GRANTS);

/**
 * Directory grants, stored resolved: `~` expands and `..` collapses here, so
 * the prefix test at each request compares canonical spellings. A relative
 * path names no directory anybody chose and is refused. One entry per
 * directory, keeping the last level given.
 */
function parsePathGrants(value: unknown): PathGrant[] {
  const grants = new Map<string, PathGrant["level"]>();
  for (const grant of pathGrantsSchema.parse(value)) {
    if (!grant.path.startsWith("/") && !grant.path.startsWith("~"))
      throw new Error(`Directory grant must be absolute: ${grant.path}`);
    grants.set(path.resolve(expandHomePath(grant.path)), grant.level);
  }
  return [...grants].map(([grantPath, level]) => ({ path: grantPath, level }));
}

/**
 * The directory a user may create projects under, as typed. An empty or
 * relative value is no grant at all: a relative root would resolve against
 * whatever the server's working directory happens to be, which is not a
 * boundary anybody chose. `~` keeps its form here and expands where the
 * check runs.
 */
function normalizeProjectRoot(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!trimmed.startsWith("/") && !trimmed.startsWith("~")) return undefined;
  // A root is a prefix test; a trailing separator only complicates it.
  const withoutTrailing = trimmed.replace(/\/+$/, "");
  return withoutTrailing === "" ? "/" : withoutTrailing;
}

function normalizeProjectList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === "string" && entry.length > 0) seen.add(entry);
  }
  return [...seen];
}

function parseInstructionBlocks(value: unknown): string[] {
  const error = instructionBlocksError(value);
  if (error) throw new Error(error);
  return [...(value as string[])];
}

function normalizeLock(value: unknown): LimitedUserLock {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const lock: LimitedUserLock = {};
  for (const field of ["provider", "model", "effort"] as const) {
    const raw = source[field];
    if (typeof raw === "string" && raw.trim().length > 0) {
      lock[field] = raw.trim();
    }
  }
  return lock;
}

export function toLimitedUserSummary(
  record: LimitedUserRecord,
): LimitedUserSummary {
  return {
    username: record.username,
    disabled: record.disabled === true,
    createdAt: record.createdAt,
    ...(record.lastLoginAt ? { lastLoginAt: record.lastLoginAt } : {}),
    newSessionProjects: [...record.newSessionProjects],
    joinProjects: [...record.joinProjects],
    viewProjects: [...record.viewProjects],
    joinStaleOffsetMinutes: record.joinStaleOffsetMinutes,
    lock: { ...record.lock },
    templateCreation: structuredClone(templateGrantFor(record)),
    instructionBlocks: [...(record.instructionBlocks ?? [])],
    ...(record.projectRoot ? { projectRoot: record.projectRoot } : {}),
    pathGrants: structuredClone(record.pathGrants ?? []),
    allowNoProjectSessions: record.allowNoProjectSessions === true,
    allowPublicApps: record.allowPublicApps === true,
    allowPrivateAppLinks: record.allowPrivateAppLinks !== false,
  };
}

export class LimitedUsersService {
  private state: LimitedUsersState = {
    version: CURRENT_VERSION,
    users: {},
  };
  private readonly filePath: string;
  private readonly dataDir: string;
  private saver = createCoalescingSaver(() => this.doSave());
  private save = this.saver.save;

  constructor(options: { dataDir: string }) {
    this.dataDir = options.dataDir;
    this.filePath = path.join(this.dataDir, "limited-users.json");
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await enforceOwnerReadWriteFilePermissions(
        this.filePath,
        "[LimitedUsersService]",
      );
      const parsed = JSON.parse(
        await fs.readFile(this.filePath, "utf-8"),
      ) as LimitedUsersState;
      this.state = {
        version: CURRENT_VERSION,
        decoySrp: parsed.decoySrp,
        users: {},
      };
      for (const [username, record] of Object.entries(parsed.users ?? {})) {
        this.state.users[username] = {
          ...record,
          username,
          newSessionProjects: normalizeProjectList(record.newSessionProjects),
          joinProjects: normalizeProjectList(record.joinProjects),
          viewProjects: normalizeProjectList(record.viewProjects),
          joinStaleOffsetMinutes: clampJoinStaleOffsetMinutes(
            record.joinStaleOffsetMinutes ?? 0,
          ),
          lock: normalizeLock(record.lock),
          instructionBlocks: parseInstructionBlocks(
            record.instructionBlocks ?? [],
          ),
          templateCreation:
            record.templateCreation === undefined
              ? templateGrantFor(record)
              : templateGrantSchema.parse(record.templateCreation),
          pathGrants: parsePathGrants(record.pathGrants ?? []),
          allowNoProjectSessions: z
            .boolean()
            .parse(record.allowNoProjectSessions ?? false),
          allowPublicApps: z.boolean().parse(record.allowPublicApps ?? false),
          allowPrivateAppLinks: z
            .boolean()
            .parse(record.allowPrivateAppLinks ?? true),
        };
      }
      if (parsed.version < CURRENT_VERSION) await this.save();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Fail closed rather than start with no users, which would silently
        // delete every account and grant (topics/security.md; auth.json has
        // the same rule). The file is left as it is.
        throw new Error(
          `[LimitedUsersService] ${this.filePath} is unreadable (${error instanceof Error ? error.message : String(error)}). ` +
            "Refusing to start without its limited users. Restore the file, " +
            "or delete it to deliberately remove them all.",
        );
      }
      this.state = { version: CURRENT_VERSION, users: {} };
    }

    if (!this.state.decoySrp) {
      // Generated once and persisted, so an unknown identity is answered with
      // a real challenge computation instead of an early error that discloses
      // which usernames exist, and with the same salt after a restart as a
      // real user's is.
      const { verifier } = await generateVerifier(
        `unknown-${crypto.randomBytes(8).toString("hex")}`,
        crypto.randomBytes(32).toString("hex"),
      );
      this.state.decoySrp = {
        secret: crypto.randomBytes(32).toString("hex"),
        verifier,
      };
      await this.save();
    }
  }

  hasUsers(): boolean {
    return Object.keys(this.state.users).length > 0;
  }

  list(): LimitedUserSummary[] {
    return Object.values(this.state.users)
      .map(toLimitedUserSummary)
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  get(username: string): LimitedUserRecord | null {
    return this.state.users[username] ?? null;
  }

  /** An enabled user's grants, or null when the name is unknown/disabled. */
  getActiveGrants(username: string): LimitedUserGrants | null {
    const record = this.get(username);
    if (!record || record.disabled === true) return null;
    const detachedId = encodeProjectId(limitedDetachedProjectPath(username));
    return {
      newSessionProjects: [
        ...record.newSessionProjects,
        ...(record.allowNoProjectSessions ? [detachedId] : []),
      ],
      joinProjects: [...record.joinProjects, detachedId],
      viewProjects: [...record.viewProjects],
      joinStaleOffsetMinutes: record.joinStaleOffsetMinutes,
      lock: { ...record.lock },
      templateCreation: structuredClone(templateGrantFor(record)),
      ...(record.projectRoot ? { projectRoot: record.projectRoot } : {}),
      pathGrants: structuredClone(record.pathGrants ?? []),
      allowNoProjectSessions: record.allowNoProjectSessions === true,
      allowPublicApps: record.allowPublicApps === true,
      allowPrivateAppLinks: record.allowPrivateAppLinks !== false,
    };
  }

  /**
   * SRP challenge inputs for an identity. Unknown or disabled identities get
   * a decoy credential whose salt is stable per identity, so the handshake
   * proceeds identically and fails only at the proof step.
   */
  getSrpChallengeInputs(username: string): {
    salt: string;
    verifier: string;
    known: boolean;
  } {
    const record = this.get(username);
    if (record && record.disabled !== true) {
      return { ...record.srp, known: true };
    }
    const decoy = this.state.decoySrp;
    if (!decoy) {
      throw new Error("LimitedUsersService.initialize() was not awaited");
    }
    return {
      salt: deriveDecoySalt(decoy.secret, username),
      verifier: decoy.verifier,
      known: false,
    };
  }

  async create(input: LimitedUserInput): Promise<LimitedUserSummary> {
    const usernameError = limitedUsernameError(input.username);
    if (usernameError) throw new Error(usernameError);
    if (this.state.users[input.username]) {
      throw new Error("A user with that name already exists");
    }
    const passwordError = limitedUserPasswordError(input.password ?? "");
    if (passwordError) throw new Error(passwordError);
    const password = input.password as string;
    const instructionBlocks = parseInstructionBlocks(
      input.instructionBlocks ?? [],
    );
    const templateCreation =
      input.templateCreation === undefined
        ? templateGrantFor({
            projectRoot: normalizeProjectRoot(input.projectRoot),
          })
        : templateGrantSchema.parse(input.templateCreation);

    const record: LimitedUserRecord = {
      username: input.username,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      srp: await generateVerifier(input.username, password),
      createdAt: new Date().toISOString(),
      newSessionProjects: normalizeProjectList(input.newSessionProjects),
      joinProjects: normalizeProjectList(input.joinProjects),
      viewProjects: normalizeProjectList(input.viewProjects),
      joinStaleOffsetMinutes: clampJoinStaleOffsetMinutes(
        input.joinStaleOffsetMinutes ?? 0,
      ),
      lock: normalizeLock(input.lock),
      instructionBlocks,
      templateCreation,
      pathGrants: parsePathGrants(input.pathGrants ?? []),
      allowNoProjectSessions: z
        .boolean()
        .parse(input.allowNoProjectSessions ?? false),
      allowPublicApps: z.boolean().parse(input.allowPublicApps ?? false),
      allowPrivateAppLinks: z
        .boolean()
        .parse(input.allowPrivateAppLinks ?? true),
      ...(normalizeProjectRoot(input.projectRoot)
        ? { projectRoot: normalizeProjectRoot(input.projectRoot) }
        : {}),
      ...(input.disabled ? { disabled: true } : {}),
    };
    this.state.users[record.username] = record;
    await this.save();
    return toLimitedUserSummary(record);
  }

  async update(
    username: string,
    input: Omit<LimitedUserInput, "username">,
  ): Promise<LimitedUserSummary> {
    const record = this.state.users[username];
    if (!record) throw new Error("User not found");

    const instructionBlocks =
      input.instructionBlocks === undefined
        ? undefined
        : parseInstructionBlocks(input.instructionBlocks);

    const templateCreation =
      input.templateCreation === undefined
        ? undefined
        : templateGrantSchema.parse(input.templateCreation);
    const pathGrants =
      input.pathGrants === undefined
        ? undefined
        : parsePathGrants(input.pathGrants);
    const appAndSessionGrants = z
      .object({
        allowNoProjectSessions: z.boolean().optional(),
        allowPublicApps: z.boolean().optional(),
        allowPrivateAppLinks: z.boolean().optional(),
      })
      .parse(input);

    if (input.password !== undefined) {
      const passwordError = limitedUserPasswordError(input.password);
      if (passwordError) throw new Error(passwordError);
      record.passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
      record.srp = await generateVerifier(username, input.password);
    }
    if (input.newSessionProjects !== undefined) {
      record.newSessionProjects = normalizeProjectList(
        input.newSessionProjects,
      );
    }
    if (input.joinProjects !== undefined) {
      record.joinProjects = normalizeProjectList(input.joinProjects);
    }
    if (input.viewProjects !== undefined) {
      record.viewProjects = normalizeProjectList(input.viewProjects);
    }
    if (input.joinStaleOffsetMinutes !== undefined) {
      record.joinStaleOffsetMinutes = clampJoinStaleOffsetMinutes(
        input.joinStaleOffsetMinutes,
      );
    }
    if (input.lock !== undefined) {
      record.lock = normalizeLock(input.lock);
    }
    if (instructionBlocks !== undefined)
      record.instructionBlocks = instructionBlocks;
    if (input.projectRoot !== undefined) {
      record.projectRoot = normalizeProjectRoot(input.projectRoot);
    }
    if (templateCreation !== undefined)
      record.templateCreation = templateCreation;
    if (pathGrants !== undefined) record.pathGrants = pathGrants;
    for (const [key, value] of Object.entries(appAndSessionGrants)) {
      if (value !== undefined) Object.assign(record, { [key]: value });
    }
    if (input.disabled !== undefined) {
      if (input.disabled) {
        record.disabled = true;
      } else {
        record.disabled = undefined;
      }
    }
    await this.save();
    return toLimitedUserSummary(record);
  }

  /**
   * Give a user the new-session grant on a project they just created, so it
   * is theirs to use the moment it exists. It is an ordinary grant: listed in
   * Settings → Users, and the superuser may revoke it like any other.
   */
  async grantNewSessionProject(
    username: string,
    projectId: string,
  ): Promise<void> {
    const record = this.state.users[username];
    if (!record) throw new Error("User not found");
    if (record.newSessionProjects.includes(projectId)) return;
    record.newSessionProjects.push(projectId);
    await this.save();
  }

  /**
   * Set one user's per-project level on one project, leaving every other
   * grant as it was. `none` removes the per-project grant; a directory grant
   * covering the project still applies.
   */
  async setProjectLevel(
    username: string,
    projectId: string,
    level: ProjectAccessLevel,
  ): Promise<void> {
    const record = this.state.users[username];
    if (!record) throw new Error("User not found");
    const without = (list: string[]) => list.filter((id) => id !== projectId);
    record.newSessionProjects = without(record.newSessionProjects);
    record.joinProjects = without(record.joinProjects);
    record.viewProjects = without(record.viewProjects);
    if (level === "new-session") record.newSessionProjects.push(projectId);
    else if (level === "join") record.joinProjects.push(projectId);
    else if (level === "view") record.viewProjects.push(projectId);
    await this.save();
  }

  async remove(username: string): Promise<boolean> {
    if (!this.state.users[username]) return false;
    delete this.state.users[username];
    await this.save();
    return true;
  }

  /**
   * Verify a direct-login password. Always runs a bcrypt comparison so an
   * unknown username costs the same as a known one.
   */
  async verifyPassword(username: string, password: string): Promise<boolean> {
    const record = this.get(username);
    const hash =
      record && record.disabled !== true
        ? record.passwordHash
        : // A well-formed hash of a value no caller can supply, so an unknown
          // username costs one bcrypt comparison like a known one does.
          await decoyPasswordHash();
    const matched = await bcrypt.compare(password, hash);
    return matched && !!record && record.disabled !== true;
  }

  async recordLogin(username: string): Promise<void> {
    const record = this.get(username);
    if (!record) return;
    record.lastLoginAt = new Date().toISOString();
    await this.save();
  }

  async flushPendingWrites(): Promise<void> {
    await this.saver.flush();
  }

  /** Wait for saves already queued; unlike a flush, never starts a write. */
  async waitForPendingWrites(): Promise<void> {
    await this.saver.idle();
  }

  private async doSave(): Promise<void> {
    const content = JSON.stringify(this.state, null, 2);
    // Atomic: an in-place write interrupted by shutdown leaves an empty file.
    await writeFileAtomically(this.filePath, content, {
      mode: OWNER_READ_WRITE_FILE_MODE,
    });
    await enforceOwnerReadWriteFilePermissions(
      this.filePath,
      "[LimitedUsersService]",
    );
  }
}

/** bcrypt hash of a random value, computed once on first unknown-name login. */
let decoyPasswordHashPromise: Promise<string> | null = null;
function decoyPasswordHash(): Promise<string> {
  decoyPasswordHashPromise ??= bcrypt.hash(
    crypto.randomBytes(32).toString("hex"),
    BCRYPT_ROUNDS,
  );
  return decoyPasswordHashPromise;
}
