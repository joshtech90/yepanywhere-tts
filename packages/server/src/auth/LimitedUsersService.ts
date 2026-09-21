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
import {
  type LimitedUserGrants,
  type LimitedUserLock,
  type LimitedUserSummary,
  clampJoinStaleOffsetMinutes,
  limitedUserPasswordError,
  limitedUsernameError,
} from "@yep-anywhere/shared";
import { generateVerifier } from "../crypto/srp-server.js";
import { createCoalescingSaver } from "../lib/coalescingSaver.js";
import {
  OWNER_READ_WRITE_FILE_MODE,
  enforceOwnerReadWriteFilePermissions,
} from "../utils/filePermissions.js";

const BCRYPT_ROUNDS = 12;
const CURRENT_VERSION = 1;

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
  /** Fixed SRP inputs answered for unknown identities, so timing matches. */
  dummySrp?: { salt: string; verifier: string };
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
  disabled?: boolean;
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
    ...(record.projectRoot ? { projectRoot: record.projectRoot } : {}),
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
        dummySrp: parsed.dummySrp,
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
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(
          "[LimitedUsersService] Failed to load state, starting fresh:",
          error,
        );
      }
      this.state = { version: CURRENT_VERSION, users: {} };
    }

    if (!this.state.dummySrp) {
      // A fixed decoy credential, generated once, so an unknown identity can
      // be answered with a real challenge computation instead of an early
      // error that discloses which usernames exist.
      this.state.dummySrp = await generateVerifier(
        `unknown-${crypto.randomBytes(8).toString("hex")}`,
        crypto.randomBytes(32).toString("hex"),
      );
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
    return {
      newSessionProjects: [...record.newSessionProjects],
      joinProjects: [...record.joinProjects],
      viewProjects: [...record.viewProjects],
      joinStaleOffsetMinutes: record.joinStaleOffsetMinutes,
      lock: { ...record.lock },
      ...(record.projectRoot ? { projectRoot: record.projectRoot } : {}),
    };
  }

  /**
   * SRP challenge inputs for an identity. Unknown or disabled identities get
   * the fixed decoy credential so the handshake proceeds identically and
   * fails only at the proof step.
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
    const dummy = this.state.dummySrp;
    if (!dummy) {
      throw new Error("LimitedUsersService.initialize() was not awaited");
    }
    return { ...dummy, known: false };
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
    if (input.projectRoot !== undefined) {
      record.projectRoot = normalizeProjectRoot(input.projectRoot);
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

  private async doSave(): Promise<void> {
    const content = JSON.stringify(this.state, null, 2);
    await fs.writeFile(this.filePath, content, {
      encoding: "utf-8",
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
