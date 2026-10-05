import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../src/auth/AuthService.js";
import * as atomicFile from "../../src/utils/writeFileAtomically.js";

describe("AuthService file permissions", () => {
  let service: AuthService;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-service-test-"));
    service = new AuthService({
      dataDir: testDir,
      cookieSecret: "test-secret",
    });
    await service.initialize();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("writes auth.json with 0600 permissions", async () => {
    if (process.platform === "win32") {
      return;
    }

    await service.createSession("test-agent");

    const filePath = path.join(testDir, "auth.json");
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("persists only a one-way verifier for each browser session", async () => {
    const sessionToken = await service.createSession("test-agent");
    const filePath = path.join(testDir, "auth.json");
    const content = await fs.readFile(filePath, "utf8");
    const persisted = JSON.parse(content) as {
      version: number;
      sessions: Record<string, unknown>;
    };
    const [verifier] = Object.keys(persisted.sessions);

    expect(persisted.version).toBe(2);
    expect(content).not.toContain(sessionToken);
    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    await expect(service.validateSession(verifier ?? "")).resolves.toBe(false);
    await expect(service.validateSession(sessionToken)).resolves.toBe(true);
  });

  it("invalidates raw version-1 session tokens during migration", async () => {
    const rawSessionToken = "a".repeat(64);
    const filePath = path.join(testDir, "auth.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        enabled: true,
        account: {
          passwordHash: "preserved-password-hash",
          createdAt: "2026-08-28T00:00:00.000Z",
        },
        sessions: {
          [rawSessionToken]: {
            createdAt: "2026-08-28T00:00:00.000Z",
            lastActiveAt: "2026-08-28T00:00:00.000Z",
          },
        },
      }),
    );

    const migrated = new AuthService({
      dataDir: testDir,
      cookieSecret: "test-secret",
    });
    await migrated.initialize();

    await expect(migrated.validateSession(rawSessionToken)).resolves.toBe(
      false,
    );
    expect(migrated.isEnabled()).toBe(true);
    const content = await fs.readFile(filePath, "utf8");
    expect(content).not.toContain(rawSessionToken);
    expect(JSON.parse(content)).toMatchObject({ version: 2, sessions: {} });
  });

  it("tightens permissions on existing auth.json files at startup", async () => {
    if (process.platform === "win32") {
      return;
    }

    const filePath = path.join(testDir, "auth.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 1, sessions: {} }, null, 2),
      "utf-8",
    );
    await fs.chmod(filePath, 0o644);

    const newService = new AuthService({
      dataDir: testDir,
      cookieSecret: "test-secret",
    });
    await newService.initialize();

    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("AuthService unreadable state", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-service-state-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // A restart that interrupted an in-place save once left auth.json empty,
  // and the server came up with no password: every browser holding another
  // credential became the owner, a limited user's included.
  for (const [label, content, reason] of [
    ["empty", "", "the authentication file is empty"],
    ["whitespace", " \n\t", "the authentication file is empty"],
    [
      "827 zero bytes",
      "\0".repeat(827),
      "the authentication file contains only zero bytes",
    ],
    [
      "partially zero-filled",
      '{"version":2}\0',
      "the authentication file contains unexpected zero bytes",
    ],
    [
      "truncated",
      '{"version":2,"enabled":true,"acc',
      "the authentication file contains invalid or truncated JSON",
    ],
    [
      "an unknown version",
      '{"version":99,"enabled":true,"sessions":{}}',
      "the authentication file has an unsupported format or version",
    ],
  ] as const) {
    it(`refuses to start from ${label} state and keeps the file`, async () => {
      const filePath = path.join(testDir, "auth.json");
      await fs.writeFile(filePath, content, { mode: 0o600 });
      const service = new AuthService({
        dataDir: testDir,
        cookieSecret: "test-secret",
      });
      await expect(service.initialize()).rejects.toThrow(
        new RegExp(
          `${reason}.*Refusing to start with local authentication off`,
        ),
      );
      expect(service.isEnabled()).toBe(false);
      expect(await fs.readFile(filePath, "utf8")).toBe(content);
    });
  }

  it("gives recovery instructions without exposing invalid credential data", async () => {
    const filePath = path.join(testDir, "auth.json");
    const privateValue = "private-credential-must-not-appear";
    const content = `{"passwordHash":"${privateValue}"} trailing`;
    await fs.writeFile(filePath, content);
    const service = new AuthService({ dataDir: testDir });

    const error = await service.initialize().catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(filePath);
    expect((error as Error).message).toContain("Preserve a backup");
    expect((error as Error).message).toContain("Restore a known-good backup");
    expect((error as Error).message).toContain("move this file aside");
    expect((error as Error).message).toContain(
      "reconfigure local authentication",
    );
    expect((error as Error).message).not.toContain(privateValue);
    expect((error as Error).message).not.toContain("Unexpected token");
    expect(await fs.readFile(filePath, "utf8")).toBe(content);
  });

  it("does not disclose an unsupported version value", async () => {
    const privateValue = "private-credential-must-not-appear";
    await fs.writeFile(
      path.join(testDir, "auth.json"),
      JSON.stringify({ version: privateValue, sessions: {} }),
    );
    const service = new AuthService({ dataDir: testDir });

    const error = await service.initialize().catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("unsupported format or version");
    expect((error as Error).message).not.toContain(privateValue);
  });

  it("refuses a failed migration even when the save error is ENOENT", async () => {
    const filePath = path.join(testDir, "auth.json");
    const content = JSON.stringify({ version: 1, enabled: true, sessions: {} });
    await fs.writeFile(filePath, content);
    const failure = Object.assign(new Error("staging directory vanished"), {
      code: "ENOENT",
    });
    vi.spyOn(atomicFile, "writeFileAtomically").mockRejectedValueOnce(failure);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new AuthService({ dataDir: testDir });

    await expect(service.initialize()).rejects.toThrow(
      /could not persist.*Refusing to start/,
    );
    expect(log).toHaveBeenCalledWith(
      "[AuthService] Failed to save state:",
      failure,
    );
    expect(service.isEnabled()).toBe(true);
    expect(await fs.readFile(filePath, "utf8")).toBe(content);
  });

  it("starts unconfigured when there is no state file at all", async () => {
    const service = new AuthService({
      dataDir: testDir,
      cookieSecret: "test-secret",
    });
    await service.initialize();
    expect(service.isEnabled()).toBe(false);
    expect(service.hasAccount()).toBe(false);
  });

  it("does not rewrite auth.json when a login is checked", async () => {
    const service = new AuthService({
      dataDir: testDir,
      cookieSecret: "test-secret",
    });
    await service.initialize();
    const sessionId = await service.createSession("agent");
    await service.flushPendingWrites();
    const filePath = path.join(testDir, "auth.json");
    const before = await fs.stat(filePath);
    for (let check = 0; check < 5; check++) {
      await expect(service.validateSession(sessionId)).resolves.toBe(true);
    }
    // Waiting, like shutdown does, must not itself write either.
    await service.waitForPendingWrites();
    const after = await fs.stat(filePath);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("saves by replacing the file, never truncating it in place", async () => {
    const service = new AuthService({
      dataDir: testDir,
      cookieSecret: "test-secret",
    });
    await service.initialize();
    await service.createSession("agent");
    const filePath = path.join(testDir, "auth.json");
    const before = (await fs.stat(filePath)).ino;
    await service.createSession("agent");
    // An atomic rename installs a new inode; an in-place write keeps it.
    expect((await fs.stat(filePath)).ino).not.toBe(before);
    expect(
      (await fs.readdir(testDir)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
});
