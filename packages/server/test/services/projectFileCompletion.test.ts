import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { EventBus } from "../../src/watcher/EventBus.js";
import { getProjectPathIndex } from "../../src/projects/projectPathIndex.js";
import { ProjectFileCompletion } from "../../src/services/projectFileCompletion.js";
import { runGit } from "../../src/git/gitExec.js";
import { createProjectFileCompletionRoutes } from "../../src/routes/project-file-completion.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import {
  toUrlProjectId,
  type ProjectFileCompletionResult,
} from "@yep-anywhere/shared";

const temporary: string[] = [];
const services: ProjectFileCompletion[] = [];
vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

function createService(
  ...args: ConstructorParameters<typeof ProjectFileCompletion>
) {
  const service = new ProjectFileCompletion(...args);
  services.push(service);
  return service;
}

async function completed(
  service: ProjectFileCompletion,
  project: string,
  query = "",
) {
  let result = await service.query(project, query, []);
  for (let i = 0; result.pending && i < 200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = await service.query(project, query, []);
  }
  expect(result.pending).toBe(false);
  return result;
}

it("stops a project inventory at its path budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-limit-"));
  temporary.push(root);
  await runGit(root, ["init", "--template="]);
  for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"])
    await writeFile(join(root, name), "fixture");
  await runGit(root, ["add", "a.txt", "b.txt", "c.txt", "d.txt"]);
  const service = createService(join(root, "data"), {
    maxPaths: 2,
  });
  const result = await service.query(root, "txt", []);
  expect(result.pending).toBe(false);
  expect(result.truncated).toBe(true);
  expect(result.entries.map((entry) => entry.path)).toEqual(["a.txt", "b.txt"]);
});

it("serves Git paths through the project route, ranking recency first and rechecking changed ignores", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-route-"));
  temporary.push(root);
  const project = join(root, "project");
  await mkdir(project);
  await runGit(project, ["init", "--template="]);
  for (const path of ["a-file.txt", "z-file.txt", "untracked-file.txt"])
    await writeFile(join(project, path), "fixture");
  await runGit(project, ["add", "a-file.txt", "z-file.txt"]);
  const id = toUrlProjectId(project);
  const routes = createProjectFileCompletionRoutes({
    scanner: {
      getProject: async () => ({ path: project }),
    } as unknown as ProjectScanner,
    dataDir: join(root, "data"),
    service: createService(join(root, "data")),
  });
  const query = async () => {
    const response = await routes.request(
      `/${id}/file-completion?q=file&recent=z-file.txt`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as ProjectFileCompletionResult;
  };
  let result = await query();
  for (let i = 0; result.pending && i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = await query();
  }
  expect(result.pending).toBe(false);
  expect(result.entries.map((entry) => entry.path)).toEqual([
    "z-file.txt",
    "a-file.txt",
    "untracked-file.txt",
  ]);
  await writeFile(
    join(project, ".gitignore"),
    "z-file.txt\nuntracked-file.txt\n",
  );
  expect((await query()).entries.map((entry) => entry.path)).toEqual([
    "a-file.txt",
  ]);
  await rm(join(project, "a-file.txt"));
  expect((await query()).entries).toEqual([]);
  expect(
    (await routes.request(`/${id}/file-completion?q=two%20words`)).status,
  ).toBe(400);
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
  vi.mocked(spawn).mockClear();
});

it("honors nested gitignore in a non-Git project without writing project metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-"));
  temporary.push(root);
  const project = join(root, "project");
  await mkdir(join(project, "nested"), { recursive: true });
  await writeFile(join(project, ".gitignore"), "*.log\n");
  await writeFile(join(project, "nested/.gitignore"), "*.txt\n!keep.txt\n");
  for (const path of ["nested/hide.txt", "nested/keep.txt", "error.log"])
    await writeFile(join(project, path), "fixture");
  const before = await readdir(project);
  const service = createService(join(root, "data"));
  let result = await service.query(project, "nested", []);
  for (let i = 0; result.pending && i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = await service.query(project, "nested", []);
  }
  expect(result.pending).toBe(false);
  expect(result.entries.map((entry) => entry.path)).toEqual([
    "nested/",
    "nested/.gitignore",
    "nested/keep.txt",
  ]);
  expect(await readdir(project)).toEqual(before);
  expect(
    (await service.query(project, "hide", ["nested/hide.txt"])).entries,
  ).toEqual([]);
});

it("stops at the byte budget, including directory entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-bytes-"));
  temporary.push(root);
  await runGit(root, ["init", "--template="]);
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested/a.txt"), "fixture");
  await writeFile(join(root, "nested/b.txt"), "fixture");
  await runGit(root, ["add", "nested"]);
  const service = createService(join(root, "data"), { maxRetainedBytes: 294 });
  const result = await completed(service, root);
  expect(result.truncated).toBe(true);
  expect(result.entries.map((entry) => entry.path)).toEqual([
    "nested/",
    "nested/a.txt",
  ]);
});

it("retains 100 project inventories and expires by last use after a week", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-many-"));
  temporary.push(root);
  let now = 0;
  const service = createService(join(root, "data"), { now: () => now });
  const projects = Array.from({ length: 100 }, (_, i) =>
    join(root, `project-${i}`),
  );
  for (const project of projects) {
    await mkdir(project);
    await writeFile(join(project, "known.txt"), "fixture");
    await completed(service, project, "known");
  }
  const calls = vi.mocked(spawn).mock.calls.length;
  for (const project of projects) {
    expect((await service.query(project, "known", [])).pending).toBe(false);
  }
  expect(vi.mocked(spawn).mock.calls.length).toBe(calls);
  now = 6 * 24 * 60 * 60 * 1000;
  const retained = projects[0]!;
  expect((await service.query(retained, "known", [])).entries[0]?.path).toBe(
    "known.txt",
  );
  await completed(service, retained);
  now += 2 * 24 * 60 * 60 * 1000;
  const refreshed = await service.query(retained, "known", []);
  expect(refreshed.entries[0]?.path).toBe("known.txt");
  await completed(service, retained);
  const beforeExpired = vi.mocked(spawn).mock.calls.length;
  await completed(service, projects[1]!, "known");
  expect(vi.mocked(spawn).mock.calls.length).toBeGreaterThan(beforeExpired);
}, 30_000);

it("notices checkout through metadata fingerprints without waiting for expiry", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-checkout-"));
  temporary.push(root);
  await runGit(root, ["init", "--template="]);
  await writeFile(join(root, "old.txt"), "fixture");
  await runGit(root, ["add", "old.txt"]);
  const commit = [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture",
  ];
  await runGit(root, commit);
  const { stdout } = await runGit(root, ["rev-parse", "HEAD"]);
  const oldRevision = stdout.trim();
  await writeFile(join(root, "new.txt"), "fixture");
  await runGit(root, ["add", "new.txt"]);
  await runGit(root, commit);
  const { stdout: next } = await runGit(root, ["rev-parse", "HEAD"]);
  await runGit(root, ["checkout", "--detach", oldRevision]);
  const service = createService(join(root, "data"), { now: () => 0 });
  expect((await completed(service, root, "new")).entries).toEqual([]);
  await runGit(root, ["checkout", "--detach", next.trim()]);
  expect((await completed(service, root, "new")).entries[0]?.path).toBe(
    "new.txt",
  );
});

it("uses existing path-index filesystem observations and activity hints for nested additions", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-fresh-"));
  temporary.push(root);
  const project = join(root, "project");
  await mkdir(join(project, "nested"), { recursive: true });
  await writeFile(join(project, "nested/old.txt"), "fixture");
  const eventBus = new EventBus();
  const service = createService(join(root, "data"), { now: () => 0, eventBus });
  await completed(service, project);
  const index = await getProjectPathIndex(project);
  try {
    await index.has("nested/old.txt");
    const revision = index.sourceRevision();
    await writeFile(join(project, "nested/new.txt"), "fixture");
    await vi.waitFor(() => expect(index.sourceRevision()).not.toBe(revision));
    expect((await completed(service, project, "new")).entries[0]?.path).toBe(
      "nested/new.txt",
    );
  } finally {
    index.release();
  }
  await writeFile(join(project, "nested/hinted.txt"), "fixture");
  eventBus.emit({
    type: "process-state-changed",
    projectId: toUrlProjectId(project),
    sessionId: "fixture",
    activity: "idle",
    timestamp: new Date().toISOString(),
  });
  expect((await completed(service, project, "hinted")).entries[0]?.path).toBe(
    "nested/hinted.txt",
  );
  await service.dispose();
  expect(eventBus.subscriberCount).toBe(0);
});

it("does not mark an inventory fresh when activity changes during enumeration", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-race-"));
  temporary.push(root);
  const project = join(root, "project");
  await mkdir(join(project, "nested"), { recursive: true });
  await writeFile(join(project, "nested/old.txt"), "fixture");
  const eventBus = new EventBus();
  const service = createService(join(root, "data"), { now: () => 0, eventBus });
  const original = vi.mocked(spawn).getMockImplementation()!;
  let changed = false;
  vi.mocked(spawn).mockImplementation((...args: Parameters<typeof spawn>) => {
    const child = original(...args);
    const gitArgs = args[1] as string[];
    if (
      !changed &&
      gitArgs.includes("--others") &&
      !gitArgs.includes("--directory")
    ) {
      changed = true;
      child.stdout?.once("end", () => {
        writeFileSync(join(project, "nested/during-scan.txt"), "fixture");
        eventBus.emit({
          type: "process-state-changed",
          projectId: toUrlProjectId(project),
          sessionId: "fixture",
          activity: "idle",
          timestamp: new Date().toISOString(),
        });
      });
    }
    return child;
  });
  try {
    expect(
      (await completed(service, project, "during-scan")).entries[0]?.path,
    ).toBe("nested/during-scan.txt");
  } finally {
    vi.mocked(spawn).mockImplementation(original);
  }
});
