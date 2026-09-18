/**
 * Publish configured model services to the provider CLIs, so the same models
 * YA offers can be selected from a plain `claude` or `codex` terminal session.
 *
 * Every file written here is YA-owned and separate from the file the user
 * edits: Codex layers `$CODEX_HOME/<name>.config.toml` over the base config
 * when invoked as `codex -p <name>`, and Claude loads an extra settings file
 * with `claude --settings <file>`. Neither `config.toml` nor `settings.json` is
 * read, modified, or merged.
 *
 * The export is opt-in, and turning it off removes what it wrote. Only files
 * carrying YA's managed marker are ever deleted.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  claudeSettingsPath,
  codexProfileName,
  codexProfilePath,
  gatewayServiceDisplayName,
  type GatewayService,
  type GatewayServiceExportPaths,
} from "@yep-anywhere/shared";
import { getLogger } from "../../logging/logger.js";
import { gatewayAutoCompactWindow } from "./claude-gateway.js";

/**
 * First line of every generated file. Recognizing our own output is what makes
 * cleanup safe: a file the user wrote by hand under the same name is left
 * alone rather than deleted.
 */
const MANAGED_MARKER = "Managed by Yep Anywhere";
const CODEX_FILE_PREFIX = "ya-";
const CODEX_FILE_SUFFIX = ".config.toml";
const CLAUDE_FILE_PREFIX = "ya-";
const CLAUDE_FILE_SUFFIX = ".settings.json";

export function defaultGatewayServiceExportPaths(): GatewayServiceExportPaths {
  return {
    codexHome: process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    claudeHome: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
  };
}

/** Codex's provider key for a service, matching what YA passes at launch. */
function codexProviderKey(service: GatewayService): string {
  return `ya_${service.id.replace(/-/gu, "_")}`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexProfileContents(service: GatewayService): string {
  const key = codexProviderKey(service);
  return [
    `# ${MANAGED_MARKER}. Regenerated when model services change; edits are lost.`,
    `# Use it with: codex -p ${codexProfileName(service)}`,
    "",
    `model_provider = ${tomlString(key)}`,
    "",
    `[model_providers.${key}]`,
    `name = ${tomlString(gatewayServiceDisplayName(service))}`,
    `base_url = ${tomlString(`${service.url}/v1`)}`,
    `wire_api = ${tomlString(service.codexWireApi)}`,
    "",
  ].join("\n");
}

/**
 * The window environment a terminal session needs.
 *
 * Claude assumes 200K for a model its catalog does not know, which silently
 * truncates a 252K-context local model. A YA launch avoids that by stating the
 * window; the export has to state the same thing, and where the service
 * declares nothing it turns the assumption off instead of inventing a number.
 */
function claudeWindowEnvironment(
  service: GatewayService,
): Record<string, string> {
  const contextWindow = service.contextWindowTokens;
  if (contextWindow === undefined) {
    return { CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1" };
  }
  const output = service.maxOutputTokens;
  const promptWindow =
    output !== undefined && output < contextWindow
      ? contextWindow - output
      : contextWindow;
  const autoCompactWindow = gatewayAutoCompactWindow(promptWindow);
  return {
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(contextWindow),
    ...(autoCompactWindow === undefined
      ? {}
      : { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(autoCompactWindow) }),
  };
}

function claudeSettingsContents(service: GatewayService): string {
  return `${JSON.stringify(
    {
      // Claude has no comment syntax in settings JSON, so the marker is a key.
      $comment: `${MANAGED_MARKER}. Regenerated when model services change; edits are lost. Use it with: claude --settings <this file>`,
      env: {
        ANTHROPIC_BASE_URL: service.url,
        ANTHROPIC_AUTH_TOKEN: "dummy",
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
        ...claudeWindowEnvironment(service),
      },
    },
    null,
    2,
  )}\n`;
}

export { gatewayServiceCliInvocations } from "@yep-anywhere/shared";

/** Write a file the user may also be reading: temporary file, then rename. */
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

/** Whether a file at this path is one YA generated. */
async function isManagedFile(path: string): Promise<boolean> {
  try {
    const contents = await readFile(path, "utf8");
    return contents.includes(MANAGED_MARKER);
  } catch {
    return false;
  }
}

async function removeStaleManagedFiles(
  directory: string,
  prefix: string,
  suffix: string,
  keep: ReadonlySet<string>,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
    const path = join(directory, entry);
    if (keep.has(path)) continue;
    if (!(await isManagedFile(path))) continue;
    await rm(path, { force: true });
    removed.push(path);
  }
  return removed;
}

export interface GatewayServiceExportResult {
  written: string[];
  removed: string[];
}

/**
 * Bring the exported files in line with the configured services.
 *
 * With the export disabled this removes every file YA previously wrote, so
 * turning the setting off is a complete undo rather than a stop.
 */
export async function syncGatewayServiceExports(options: {
  services: readonly GatewayService[];
  enabled: boolean;
  paths?: GatewayServiceExportPaths;
}): Promise<GatewayServiceExportResult> {
  const paths = options.paths ?? defaultGatewayServiceExportPaths();
  const exported = options.enabled
    ? options.services.filter((service) => service.enabled && service.url)
    : [];

  const written: string[] = [];
  const codexKeep = new Set<string>();
  const claudeKeep = new Set<string>();

  for (const service of exported) {
    const claudePath = claudeSettingsPath(paths, service);
    claudeKeep.add(claudePath);
    try {
      await mkdir(paths.claudeHome, { recursive: true });
      await writeAtomic(claudePath, claudeSettingsContents(service));
      written.push(claudePath);
    } catch (error) {
      getLogger().warn(
        { error, serviceId: service.id, path: claudePath },
        "Could not export a model service for the Claude CLI",
      );
    }

    if (!service.codexEnabled) continue;
    const codexPath = codexProfilePath(paths, service);
    codexKeep.add(codexPath);
    try {
      await mkdir(paths.codexHome, { recursive: true });
      await writeAtomic(codexPath, codexProfileContents(service));
      written.push(codexPath);
    } catch (error) {
      getLogger().warn(
        { error, serviceId: service.id, path: codexPath },
        "Could not export a model service for the Codex CLI",
      );
    }
  }

  const removed = [
    ...(await removeStaleManagedFiles(
      paths.claudeHome,
      CLAUDE_FILE_PREFIX,
      CLAUDE_FILE_SUFFIX,
      claudeKeep,
    )),
    ...(await removeStaleManagedFiles(
      paths.codexHome,
      CODEX_FILE_PREFIX,
      CODEX_FILE_SUFFIX,
      codexKeep,
    )),
  ];

  return { written, removed };
}
