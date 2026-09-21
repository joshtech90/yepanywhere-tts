/**
 * Publish configured model services to pi's model registry.
 *
 * The Claude and Codex exports each write a YA-owned file that the CLI loads on
 * request (`claude --settings`, `codex -p`), so the user's own configuration is
 * never touched. pi has no such per-launch override: `ModelConfig.load()` reads
 * exactly one file, `<agent dir>/models.json`, and `PI_CODING_AGENT_DIR` moves
 * the whole agent directory — auth, sessions and settings with it — rather than
 * the model registry alone. Verified against installed Pi 0.85.1.
 *
 * So this export merges into the user's file, which is the deliberate exception
 * to "YA never rewrites a CLI's own settings file" recorded in
 * `topics/gateway-services.md`. Ownership is by provider id: every provider
 * named `ya-<service id>` belongs to YA and is rewritten or removed with the
 * services list, and every other key in the file is preserved. The file is
 * copied to `models.json.ya-backup` once before the first rewrite, because a
 * hand-maintained registry is not otherwise recoverable.
 */

import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  gatewayServiceDisplayName,
  piProviderName,
  type GatewayService,
  type ModelInfo,
} from "@yep-anywhere/shared";
import { getLogger } from "../../logging/logger.js";

/** Provider ids under YA's control, as written into the user's registry. */
const PI_PROVIDER_PREFIX = "ya-";

/** pi's wire name for an OpenAI-compatible chat endpoint. */
const PI_OPENAI_API = "openai-completions";

/** What pi needs to know about one model to offer it. */
interface PiModelEntry {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

interface PiProviderEntry {
  baseUrl: string;
  api: string;
  apiKey: string;
  models: PiModelEntry[];
}

interface PiModelsConfig {
  providers?: Record<string, unknown>;
  [key: string]: unknown;
}

/** pi's agent directory, honoring the same override pi itself reads. */
export function piAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (configured?.trim()) {
    const path = configured.trim();
    return path.startsWith("~")
      ? join(homedir(), path.slice(1).replace(/^[/\\]/u, ""))
      : path;
  }
  return join(homedir(), ".pi", "agent");
}

export function piModelsJsonPath(agentDir: string = piAgentDir()): string {
  return join(agentDir, "models.json");
}

/**
 * One service's provider entry, or undefined when there is nothing to offer.
 *
 * A service whose catalog has not been read yet contributes no models. Writing
 * it as an empty provider would hide the models pi already knew about, so the
 * caller keeps the previous entry instead.
 */
export function piProviderEntry(
  service: GatewayService,
  models: readonly ModelInfo[],
): PiProviderEntry | undefined {
  if (models.length === 0) return undefined;
  const where = gatewayServiceDisplayName(service);
  return {
    baseUrl: `${service.url.replace(/\/+$/u, "")}/v1`,
    api: PI_OPENAI_API,
    // The catalog reads YA already makes send a literal dummy bearer; a service
    // needing a real key has nowhere to put one yet either way.
    apiKey: "none",
    models: models.map((model) => ({
      id: model.id,
      name: `${model.name} (${where})`,
      // pi decides whether to offer a thinking level from this flag, and the
      // same resolution already decided whether YA offers one.
      reasoning: (model.supportedEffortLevels?.length ?? 0) > 0,
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(service.maxOutputTokens
        ? { maxTokens: service.maxOutputTokens }
        : {}),
    })),
  };
}

/**
 * The registry as it should stand, given the one on disk.
 *
 * Returns undefined when nothing would change, so an unchanged export never
 * rewrites a file the user may be editing.
 */
export function mergedPiModelsConfig(
  existing: PiModelsConfig,
  owned: ReadonlyMap<string, PiProviderEntry>,
): PiModelsConfig | undefined {
  const providers: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(existing.providers ?? {})) {
    if (id.startsWith(PI_PROVIDER_PREFIX)) continue;
    providers[id] = entry;
  }
  for (const [id, entry] of owned) providers[id] = entry;

  const next: PiModelsConfig = { ...existing, providers };
  return JSON.stringify(next) === JSON.stringify(existing) ? undefined : next;
}

async function readPiModelsConfig(path: string): Promise<PiModelsConfig> {
  try {
    const raw = await readFile(path, "utf8");
    // pi tolerates comments here; JSON.parse does not. A file YA cannot read
    // as plain JSON is left alone rather than rewritten from a guess.
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PiModelsConfig;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  return {};
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Keep the registry as it was before YA first touched it. */
async function backUpOnce(path: string): Promise<void> {
  // COPYFILE_EXCL makes this a one-time copy: a backup already taken is the
  // user's own file, and must not be replaced by a state YA itself wrote.
  await copyFile(path, `${path}.ya-backup`, constants.COPYFILE_EXCL).catch(
    () => undefined,
  );
}

/** What the last export knew, so a later catalog read can refresh it. */
let lastExport: {
  enabled: boolean;
  services: readonly GatewayService[];
} = { enabled: false, services: [] };

export interface PiModelExportResult {
  path: string;
  providers: string[];
  changed: boolean;
}

export async function syncPiModelExport(options: {
  services: readonly GatewayService[];
  enabled: boolean;
  /** Models per service id, from the most recent catalog reads. */
  models: ReadonlyMap<string, readonly ModelInfo[]>;
  agentDir?: string;
}): Promise<PiModelExportResult> {
  lastExport = { enabled: options.enabled, services: options.services };
  const path = piModelsJsonPath(options.agentDir ?? piAgentDir());
  const existing = await readPiModelsConfig(path);
  const owned = new Map<string, PiProviderEntry>();

  if (options.enabled) {
    for (const service of options.services) {
      if (!service.enabled || !service.url) continue;
      const id = piProviderName(service);
      const entry = piProviderEntry(
        service,
        options.models.get(service.id) ?? [],
      );
      // An unread catalog keeps whatever pi was already told, so a restart
      // before the first read does not empty a working registry.
      const previous = existing.providers?.[id];
      if (entry) owned.set(id, entry);
      else if (previous) owned.set(id, previous as PiProviderEntry);
    }
  }

  const next = mergedPiModelsConfig(existing, owned);
  if (!next) return { path, providers: [...owned.keys()], changed: false };

  try {
    await backUpOnce(path);
    await writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    getLogger().warn(
      { error, path },
      "Could not export model services to pi's registry",
    );
    return { path, providers: [...owned.keys()], changed: false };
  }
  return { path, providers: [...owned.keys()], changed: true };
}

/**
 * Re-export after a catalog read, using the services the last export saw.
 *
 * The models are only known once an endpoint has answered, which is usually
 * after the settings that configured it were applied.
 */
export async function refreshPiModelExport(
  models: ReadonlyMap<string, readonly ModelInfo[]>,
): Promise<void> {
  if (!lastExport.enabled) return;
  await syncPiModelExport({ ...lastExport, models });
}
