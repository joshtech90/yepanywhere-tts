import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexSessionReader } from "../../src/sessions/codex-reader.js";
import {
  getForkedSessionFile,
  registerForkedSessionFile,
} from "../../src/sessions/fork-discovery.js";
import { PiSessionReader } from "../../src/sessions/pi-reader.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readdir: vi.fn(original.readdir) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(readdir).mockReset();
  vi.mocked(readdir).mockImplementation(
    (
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      )
    ).readdir,
  );
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture(provider: "codex" | "pi") {
  const dir = await mkdtemp(join(tmpdir(), "fork-discovery-"));
  directories.push(dir);
  const sessionsDir = join(dir, "sessions");
  const bucket = join(sessionsDir, "2026");
  const projectPath = join(dir, "project");
  await mkdir(bucket, { recursive: true });
  const writeSession = async (id: string, cwd = projectPath) => {
    const filePath = join(
      bucket,
      provider === "codex" ? `rollout-${id}.jsonl` : `2026_${id}.jsonl`,
    );
    const timestamp = "2026-09-09T08:00:00.000Z";
    const entry =
      provider === "codex"
        ? { type: "session_meta", payload: { id, cwd, timestamp } }
        : { type: "session", version: 3, id, cwd, timestamp };
    await writeFile(filePath, `${JSON.stringify(entry)}\n`);
    return filePath;
  };
  const makeReader = (root = sessionsDir, cwd = projectPath) =>
    provider === "codex"
      ? new CodexSessionReader({ sessionsDir: root, projectPath: cwd })
      : new PiSessionReader({ sessionsDir: root, projectPath: cwd });
  return { sessionsDir, bucket, projectPath, writeSession, makeReader };
}

describe("targeted fork discovery", () => {
  for (const provider of ["codex", "pi"] as const) {
    it(`${provider}: validates the hinted session and project`, async () => {
      const { projectPath, writeSession, makeReader } = await fixture(provider);
      const sourceId = randomUUID();
      await writeSession(sourceId);
      const reader = makeReader();
      await reader.getSessionFilePath(sourceId);
      const childId = randomUUID();
      const filePath = await writeSession(childId, `${projectPath}-other`);
      registerForkedSessionFile(provider, childId, filePath);
      expect(await reader.getSessionFilePath(childId)).toBeNull();
      const wrongId = randomUUID();
      registerForkedSessionFile(provider, wrongId, filePath);
      expect(await reader.getSessionFilePath(wrongId)).toBeNull();
      expect(
        await makeReader(undefined, `${projectPath}-other`).getSessionFilePath(
          childId,
        ),
      ).toBe(filePath);
    });

    it(`${provider}: an older in-flight scan cannot hide a registered fork`, async () => {
      const { sessionsDir, bucket, writeSession, makeReader } =
        await fixture(provider);
      const sourceId = randomUUID();
      await writeSession(sourceId);
      const reader = makeReader();
      expect(await reader.getSessionFilePath(sourceId)).toBeTruthy();

      const now = Date.now.bind(Date);
      vi.spyOn(Date, "now").mockImplementation(() => now() + 6000);
      let release!: () => void;
      let captured!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        captured = resolve;
      });
      const original = (
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        )
      ).readdir;
      let blocked = false;
      vi.mocked(readdir).mockImplementation(
        async (...args: Parameters<typeof readdir>) => {
          const files = await original(...args);
          if (String(args[0]) === bucket && !blocked) {
            blocked = true;
            captured();
            await hold;
          }
          return files;
        },
      );
      const scan = reader.listSessionFiles(sessionsDir);
      await ready;
      try {
        const childId = randomUUID();
        const filePath = await writeSession(childId);
        registerForkedSessionFile(provider, childId, filePath);
        const callsBeforeLookup = vi.mocked(readdir).mock.calls.length;
        expect(await reader.getSessionFilePath(childId)).toBe(filePath);
        expect(readdir).toHaveBeenCalledTimes(callsBeforeLookup);
        release();
        await scan;
        expect(await reader.getSessionFilePath(childId)).toBe(filePath);
        expect(await makeReader().getSessionFilePath(childId)).toBe(filePath);
        expect(readdir).toHaveBeenCalledTimes(callsBeforeLookup);
      } finally {
        release();
        await scan;
      }
    });

    it(`${provider}: hints cannot cross provider roots and missing files stay missing`, async () => {
      const { sessionsDir, writeSession, makeReader } = await fixture(provider);
      const id = randomUUID();
      const filePath = await writeSession(id);
      registerForkedSessionFile(provider, id, filePath);
      const otherRoot = `${sessionsDir}-other`;
      expect(
        await getForkedSessionFile(provider, id, otherRoot),
      ).toBeUndefined();
      expect(await makeReader(otherRoot).getSessionFilePath(id)).toBeNull();
      expect(
        await getForkedSessionFile(
          provider === "codex" ? "pi" : "codex",
          id,
          sessionsDir,
        ),
      ).toBeUndefined();
      await rm(filePath);
      expect(await makeReader().getSessionFilePath(id)).toBeNull();
    });
  }

  it("resolves store aliases and rejects a path outside the physical store", async (context) => {
    const { sessionsDir, writeSession } = await fixture("codex");
    const id = randomUUID();
    const filePath = await writeSession(id);
    const alias = `${sessionsDir}-alias`;
    try {
      await symlink(
        sessionsDir,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        process.platform === "win32" &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        context.skip();
        return;
      }
      throw error;
    }
    registerForkedSessionFile("codex", id, filePath);
    expect(await getForkedSessionFile("codex", id, alias)).toBe(filePath);
    const outside = join(sessionsDir, "empty-store");
    await mkdir(outside);
    expect(await getForkedSessionFile("codex", id, outside)).toBeUndefined();
  });
});
