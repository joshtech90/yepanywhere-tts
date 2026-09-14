import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, expect, it, vi } from "vitest";
import { SessionCatalogService } from "../../src/services/SessionCatalogService.js";
import { RetainedSessionCollections } from "../../src/services/RetainedSessionCollections.js";
import { createGlobalSessionsRoutes } from "../../src/routes/global-sessions.js";
import { createInboxRoutes } from "../../src/routes/inbox.js";
import type {
  NativeSessionCatalogAdapter,
  SessionCatalogRow,
} from "../../src/sessions/catalog-types.js";
import { ProjectScanner } from "../../src/projects/scanner.js";
import { ClaudeSessionReader } from "../../src/sessions/reader.js";
import { EventBus } from "../../src/watcher/EventBus.js";
import { collectionCatalogAdapters } from "../../src/sessions/catalog-adapters/collection-catalog-adapters.js";
import { CodexSessionReader } from "../../src/sessions/codex-reader.js";
import { catalogProjectIdentity } from "../../src/sessions/catalog-adapters/row.js";
import type { Project } from "../../src/supervisor/types.js";
import { readClaudeCatalogTitle } from "../../src/sessions/claude-summary.js";

let dataDir: string;
let collections: RetainedSessionCollections | undefined;
let unblock = () => {};
afterEach(async () => {
  unblock();
  await collections?.dispose();
  if (dataDir) await rm(dataDir, { recursive: true });
  vi.restoreAllMocks();
});

it("serves a durable generation through both routes while one shared refresh is blocked", async () => {
  dataDir = await mkdtemp(join(tmpdir(), "retained-collections-"));
  const projectId = toUrlProjectId("/work/project");
  const row: SessionCatalogRow = {
    catalogFamily: "claude",
    storeKey: "store",
    sessionId: "saved",
    projectId,
    projectPath: "/work/project",
    projectIdentityKey: "/work/project",
    projectName: "Project",
    updatedAt: new Date().toISOString(),
    title: "Saved title",
    fidelity: "head",
    sourceVersion: "v1",
    location: { kind: "provider", recordId: "saved" },
  };
  const adapter: NativeSessionCatalogAdapter = {
    catalogFamily: "claude",
    storeKey: "store",
    scan: async () => ({ sourceVersion: "v1", rows: [row] }),
  };
  const seed = new SessionCatalogService({ dataDir });
  await seed.initialize();
  const seeded = await seed.reconcile([adapter]);
  seed.stop();
  let starts = 0;
  let entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const bus = new EventBus();
  const events: string[] = [];
  bus.subscribe((event) => events.push(event.type));
  collections = new RetainedSessionCollections({
    dataDir,
    eventBus: bus,
    adapters: async () => {
      starts++;
      entered();
      await blocked;
      return [adapter];
    },
  });
  const refresh = collections.refresh();
  await started;
  const deps = {
    retainedCollections: collections,
    eventBus: bus,
    scanner: new ProjectScanner({
      projectsDir: join(dataDir, "no-provider-store"),
    }),
    readerFactory: () =>
      new ClaudeSessionReader({
        sessionDir: join(dataDir, "no-provider-store"),
      }),
  };
  const global = createGlobalSessionsRoutes(deps);
  const inbox = createInboxRoutes(deps);
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      index % 2
        ? global
            .request("/?summaryMode=retained&knownGeneration=1")
            .then((response) => response.json())
        : inbox
            .request("/?summaryMode=retained")
            .then((response) => response.json()),
    ),
  );
  expect(starts).toBe(1);
  for (const response of responses) {
    expect(response.catalog).toMatchObject({
      catalogEpoch: seeded.snapshot.catalogEpoch,
      catalogGeneration: 1,
      complete: true,
      refreshing: true,
    });
    const item = response.sessions?.[0] ?? response.recentActivity[0];
    expect(item.title ?? item.sessionTitle).toBe("Saved title");
    expect(item).not.toHaveProperty("messageCount");
    expect(item).not.toHaveProperty("initialPrompt");
  }
  const starred = await global.request("/?summaryMode=retained&starred=true");
  expect((await starred.json()).sessions).toEqual([]);
  unblock();
  await refresh;
  expect(events).toContain("session-catalog-updated");
  expect((await collections.read()).catalog.refreshing).toBe(false);
});

it("publishes native heads before questions and refreshes only a modified session", async () => {
  dataDir = await mkdtemp(join(tmpdir(), "retained-native-"));
  const projectPath = join(dataDir, "project");
  const project: Project = {
    id: catalogProjectIdentity(projectPath).projectId,
    path: projectPath,
    name: "Project",
    provider: "codex",
    sessionDir: dataDir,
    sessionCount: 2,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
  };
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const files = ids.map((id) =>
    join(dataDir, `rollout-2026-09-08T00-00-00-${id}.jsonl`),
  );
  for (const [index, file] of files.entries()) {
    await writeFile(
      file,
      `${[
        {
          type: "session_meta",
          payload: {
            id: ids[index],
            cwd: projectPath,
            timestamp: "2026-09-08T00:00:00.000Z",
          },
        },
        {
          type: "event_msg",
          payload: { type: "user_message", message: `Work ${index}` },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`,
    );
  }
  const scanner = new ProjectScanner({ projectsDir: join(dataDir, "unused") });
  const discovery = vi
    .spyOn(scanner, "listProjects")
    .mockResolvedValue([project]);
  const reader = new CodexSessionReader({ sessionsDir: dataDir, projectPath });
  const headReads = vi.spyOn(reader, "getSessionListSummary");
  const fileLists = vi.spyOn(reader, "listSessionFiles");
  const bus = new EventBus();
  const publications: Promise<
    Awaited<ReturnType<RetainedSessionCollections["read"]>>
  >[] = [];
  bus.subscribe((event) => {
    if (event.type === "session-catalog-updated" && event.catalog.refreshing) {
      publications.push(collections!.read());
    }
  });
  collections = new RetainedSessionCollections({
    dataDir,
    eventBus: bus,
    shouldReadQuestions: (row) => row.sessionId === ids[0],
    adapters: (rows, signal, paths) =>
      collectionCatalogAdapters(
        {
          scanner,
          readerFactory: () => {
            throw new Error("Unexpected Claude reader");
          },
          codexSessionsDir: dataDir,
          codexReaderFactory: () => reader,
          geminiScanner: {
            getHashToCwd: async () => {
              throw new Error("Unexpected Gemini lookup");
            },
          },
          getCatalogFamilies: () => ["codex"],
        },
        rows,
        signal,
        paths,
      ),
  });
  await collections.refresh();
  const base = await publications[0]!;
  expect(base.rows).toHaveLength(2);
  expect(base.rows.every((row) => row.asyncQuestions === undefined)).toBe(true);
  const ready = await collections.read();
  expect(
    ready.rows.find((row) => row.sessionId === ids[0])?.asyncQuestions,
  ).toEqual({ questions: [], omitted: false });
  expect(
    ready.rows.find((row) => row.sessionId === ids[1])?.asyncQuestions,
  ).toBeUndefined();
  expect(headReads).toHaveBeenCalledTimes(2);
  discovery.mockClear();
  fileLists.mockClear();
  headReads.mockClear();
  await appendFile(
    files[0]!,
    `${JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "More work" },
    })}\n`,
  );
  bus.emit({
    type: "file-change",
    provider: "codex",
    path: files[0]!,
    relativePath: "rollout.jsonl",
    fileType: "session",
    changeType: "modify",
    timestamp: new Date().toISOString(),
  });
  await collections.refresh();
  expect(discovery).not.toHaveBeenCalled();
  expect(fileLists).not.toHaveBeenCalled();
  expect(headReads).toHaveBeenCalledTimes(1);
  expect(headReads.mock.calls[0]?.[0]).toBe(ids[0]);
  expect((await collections.read()).rows).toHaveLength(2);
  await collections.refresh();
  expect(headReads).toHaveBeenCalledTimes(1);
});

it("bounds Claude title discovery and uses the canonical command title", async () => {
  dataDir = await mkdtemp(join(tmpdir(), "retained-claude-"));
  const file = join(dataDir, "session.jsonl");
  const user = JSON.stringify({
    type: "user",
    message: {
      content:
        "<command-name>/review</command-name><command-args>the change</command-args>",
    },
  });
  await writeFile(file, `null\nmalformed\n${user}\n`);
  expect(await readClaudeCatalogTitle(file)).toBe("/review the change");
  await writeFile(
    file,
    `${JSON.stringify({ type: "system", content: "x".repeat(300 * 1024) })}\n${user}\n`,
  );
  expect(await readClaudeCatalogTitle(file)).toBeUndefined();
});

it("keeps the last accepted rows on failure and stops publication after disposal", async () => {
  dataDir = await mkdtemp(join(tmpdir(), "retained-failure-"));
  const identity = catalogProjectIdentity(join(dataDir, "project"));
  const row: SessionCatalogRow = {
    ...identity,
    catalogFamily: "claude",
    storeKey: "store",
    sessionId: "saved",
    updatedAt: new Date().toISOString(),
    title: "Retained",
    fidelity: "head",
    sourceVersion: "v1",
    location: { kind: "provider", recordId: "saved" },
  };
  const adapters = vi.fn(
    async (): Promise<NativeSessionCatalogAdapter[]> => [
      {
        catalogFamily: "claude",
        storeKey: "store",
        scan: async () => ({ sourceVersion: "v1", rows: [row] }),
      },
    ],
  );
  const bus = new EventBus();
  const emitted = vi.spyOn(bus, "emit");
  collections = new RetainedSessionCollections({
    dataDir,
    eventBus: bus,
    adapters,
  });
  expect((await collections.read()).catalog).toMatchObject({
    complete: false,
    refreshing: true,
  });
  await collections.refresh();
  const before = await collections.read();
  adapters.mockRejectedValueOnce(new Error("Provider unavailable"));
  await collections.refresh();
  const after = await collections.read();
  expect(after.rows).toEqual(before.rows);
  expect(after.catalog).toMatchObject({
    catalogGeneration: before.catalog.catalogGeneration,
    complete: true,
    refreshing: false,
    refreshError: "Provider unavailable",
  });
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  adapters.mockImplementationOnce(async () => {
    entered();
    await blocked;
    return [];
  });
  const work = collections.refresh();
  await started;
  const disposal = collections.dispose();
  emitted.mockClear();
  unblock();
  await Promise.all([work, disposal]);
  expect(emitted).not.toHaveBeenCalled();
});
