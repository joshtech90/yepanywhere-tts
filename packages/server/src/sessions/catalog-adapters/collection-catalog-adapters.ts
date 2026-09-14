import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ProjectScanner } from "../../projects/scanner.js";
import type { Project } from "../../supervisor/types.js";
import { getCodexRolloutActivityTimeMs } from "../../utils/codexRolloutFiles.js";
import { buildProviderProjectCatalog } from "../../routes/provider-catalog.js";
import {
  providerResolutionDeps,
  type SessionProviderResolutionDeps,
} from "../../routes/session-provider-resolution.js";
import {
  getSessionSources,
  type SessionSource,
} from "../provider-resolution.js";
import {
  providerCatalogFamily,
  type ProviderCatalogFamily,
} from "../provider-catalog-family.js";
import {
  type NativeSessionCatalogAdapter,
  type SessionCatalogRow,
  sessionCatalogRowKey,
} from "../catalog-types.js";
import { toSessionListSummary } from "../types.js";
import { readClaudeCatalogTitle } from "../claude-summary.js";
import { GrokSessionCatalogAdapter } from "./grok-catalog-adapter.js";
import { PiSessionCatalogAdapter } from "./pi-catalog-adapter.js";
import { OpenCodeSessionCatalogAdapter } from "./opencode-catalog-adapter.js";
import {
  catalogAdaptersForRows,
  catalogFileVersion,
  catalogProjectIdentity,
} from "./row.js";

export interface CollectionCatalogDeps extends SessionProviderResolutionDeps {
  scanner: ProjectScanner;
  getCatalogFamilies: () => readonly ProviderCatalogFamily[];
}

async function sessionFiles(source: SessionSource) {
  if (source.reader.listSessionFiles)
    return source.reader.listSessionFiles(source.sessionDir);
  try {
    return (await readdir(source.sessionDir))
      .filter((name) => name.endsWith(".jsonl") && !name.startsWith("agent-"))
      .map((name) => ({
        sessionId: name.slice(0, -6),
        filePath: join(source.sessionDir, name),
      }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readFileRow(
  deps: CollectionCatalogDeps,
  project: Project,
  source: SessionSource,
  file: { sessionId: string; filePath: string },
  old?: Readonly<SessionCatalogRow>,
): Promise<SessionCatalogRow | undefined> {
  const family = providerCatalogFamily(source.provider);
  try {
    const stats = await stat(file.filePath);
    const sourceVersion = catalogFileVersion(stats);
    if (old?.sourceVersion === sourceVersion)
      return { ...old, projectName: project.name };
    const cached = await deps.sessionIndexService?.getCachedSessionSummary(
      source.sessionDir,
      project.id,
      file.sessionId,
      source.reader,
    );
    const summary = cached
      ? toSessionListSummary(cached)
      : await source.reader.getSessionListSummary?.(
          file.sessionId,
          project.id,
          undefined,
          { deferAsyncQuestions: true },
        );
    const title =
      summary?.title ??
      (family === "claude"
        ? await readClaudeCatalogTitle(file.filePath)
        : undefined);
    const after = await stat(file.filePath);
    if (catalogFileVersion(after) !== sourceVersion) {
      // Never label facts read across an append/replacement as an exact projection.
      if (old) return old;
      return {
        catalogFamily: family,
        storeKey: source.sessionDir,
        sessionId: file.sessionId,
        ...catalogProjectIdentity(project.path),
        projectId: project.id,
        projectName: project.name,
        provider: source.provider,
        updatedAt: new Date(stats.mtimeMs).toISOString(),
        fidelity: "identity",
        sourceVersion: `unsettled:${sourceVersion}`,
        location: { kind: "file", path: file.filePath },
      };
    }
    return {
      catalogFamily: family,
      storeKey: source.sessionDir,
      sessionId: file.sessionId,
      ...catalogProjectIdentity(project.path),
      projectId: project.id,
      projectName: project.name,
      provider: summary?.provider ?? source.provider,
      updatedAt:
        summary?.updatedAt ??
        new Date(
          family === "codex"
            ? getCodexRolloutActivityTimeMs(file.filePath, stats)
            : stats.mtimeMs,
        ).toISOString(),
      ...(cached ? { createdAt: cached.createdAt } : {}),
      ...(title !== undefined ? { title: title?.slice(0, 1024) } : {}),
      fidelity: summary || title ? "head" : "identity",
      sourceVersion,
      location: { kind: "file", path: file.filePath },
      ...(summary?.asyncQuestions
        ? { asyncQuestions: summary.asyncQuestions }
        : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function refreshChangedRows(
  deps: CollectionCatalogDeps,
  previousRows: readonly Readonly<SessionCatalogRow>[],
  signal: AbortSignal,
  changedPaths: ReadonlySet<string>,
): Promise<NativeSessionCatalogAdapter[] | undefined> {
  const knownPaths = new Set(
    previousRows
      .filter(
        (row) =>
          row.location.kind === "file" &&
          ["claude", "codex", "gemini"].includes(row.catalogFamily),
      )
      .map((row) => (row.location.kind === "file" ? row.location.path : "")),
  );
  // A newly observed file needs discovery to establish its project membership.
  if ([...changedPaths].some((path) => !knownPaths.has(path))) return undefined;
  const rows: SessionCatalogRow[] = [];
  const needsGemini = previousRows.some(
    (row) =>
      row.catalogFamily === "gemini" &&
      row.location.kind === "file" &&
      changedPaths.has(row.location.path),
  );
  const resolution = providerResolutionDeps({
    ...deps,
    geminiScanner: needsGemini ? deps.geminiScanner : undefined,
  });
  for (const row of previousRows) {
    signal.throwIfAborted();
    if (row.location.kind !== "file" || !changedPaths.has(row.location.path)) {
      rows.push(row);
      continue;
    }
    const project: Project = {
      id: row.projectId,
      path: row.projectPath,
      name: row.projectName ?? basename(row.projectPath),
      provider: row.provider ?? row.catalogFamily,
      sessionDir: row.storeKey,
      sessionCount: 1,
      activeOwnedCount: 0,
      activeExternalCount: 0,
      lastActivity: row.updatedAt,
    };
    const source = getSessionSources(
      project,
      resolution,
      project.provider,
      undefined,
      new Set([row.catalogFamily]),
    )[0];
    if (!source) throw new Error(`No catalog reader for ${row.catalogFamily}`);
    const refreshed = await readFileRow(
      deps,
      project,
      source,
      { sessionId: row.sessionId, filePath: row.location.path },
      row,
    );
    if (refreshed) rows.push(refreshed);
  }
  return catalogAdaptersForRows(rows);
}

export async function collectionCatalogAdapters(
  deps: CollectionCatalogDeps,
  previousRows: readonly Readonly<SessionCatalogRow>[],
  signal: AbortSignal,
  changedPaths?: ReadonlySet<string>,
): Promise<NativeSessionCatalogAdapter[]> {
  if (changedPaths) {
    const targeted = await refreshChangedRows(
      deps,
      previousRows,
      signal,
      changedPaths,
    );
    if (targeted) return targeted;
  }
  const families = new Set(deps.getCatalogFamilies());
  const fileFamilies = new Set(
    [...families].filter((family) =>
      ["claude", "codex", "gemini"].includes(family),
    ),
  );
  const projects = fileFamilies.size ? await deps.scanner.listProjects() : [];
  signal.throwIfAborted();
  const providerCatalog = await buildProviderProjectCatalog({ projects });
  const resolution = providerResolutionDeps({
    ...deps,
    geminiScanner: fileFamilies.has("gemini") ? deps.geminiScanner : undefined,
  });
  const previous = new Map(
    previousRows.map((row) => [sessionCatalogRowKey(row), row]),
  );
  const adapters: NativeSessionCatalogAdapter[] = [];
  const stores = new Map<
    string,
    {
      family: ProviderCatalogFamily;
      storeKey: string;
      sources: { project: Project; source: SessionSource }[];
    }
  >();
  for (const project of projects) {
    for (const source of getSessionSources(
      project,
      resolution,
      undefined,
      providerCatalog,
      fileFamilies,
    )) {
      const family = providerCatalogFamily(source.provider);
      if (
        !families.has(family) ||
        !["claude", "codex", "gemini"].includes(family)
      )
        continue;
      const key = JSON.stringify([family, source.sessionDir]);
      let store = stores.get(key);
      if (!store) {
        store = { family, storeKey: source.sessionDir, sources: [] };
        stores.set(key, store);
      }
      store.sources.push({ project, source });
      if (family === "claude") {
        for (const sessionDir of project.mergedSessionDirs ?? []) {
          const mergedKey = JSON.stringify([family, sessionDir]);
          if (!stores.has(mergedKey))
            stores.set(mergedKey, {
              family,
              storeKey: sessionDir,
              sources: [
                {
                  project,
                  source: {
                    ...source,
                    sessionDir,
                    reader: deps.readerFactory({ ...project, sessionDir }),
                  },
                },
              ],
            });
        }
      }
    }
  }
  for (const { family, storeKey, sources } of stores.values()) {
    adapters.push({
      catalogFamily: family,
      storeKey,
      scan: async (context) => ({
        sourceVersion: `reconciliation:${context.targetGeneration}`,
        rows: (async function* () {
          const seen = new Set<string>();
          for (const { project, source } of sources) {
            for (const file of await sessionFiles(source)) {
              context.signal.throwIfAborted();
              signal.throwIfAborted();
              if (seen.has(file.sessionId)) continue;
              seen.add(file.sessionId);
              const old = previous.get(
                sessionCatalogRowKey({
                  catalogFamily: family,
                  storeKey,
                  sessionId: file.sessionId,
                }),
              );
              const row = await readFileRow(deps, project, source, file, old);
              if (row) yield row;
            }
          }
        })(),
      }),
    });
  }
  if (families.has("grok"))
    adapters.push(
      new GrokSessionCatalogAdapter({ sessionsDir: deps.grokSessionsDir }),
    );
  if (families.has("pi"))
    adapters.push(
      new PiSessionCatalogAdapter({ sessionsDir: deps.piSessionsDir }),
    );
  if (families.has("opencode"))
    adapters.push(new OpenCodeSessionCatalogAdapter());
  return adapters;
}
