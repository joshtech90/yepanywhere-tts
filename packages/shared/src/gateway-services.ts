/**
 * Configured model-serving endpoints ("gateway services").
 *
 * One entry describes an OpenAI/Anthropic-compatible HTTP server: where it
 * listens, optionally how to start and stop it, what its models can hold, and
 * which harness narrowings apply to launches routed through it. Claude Gateway
 * reads every enabled entry; CodexOSS reads the entries that opt in.
 *
 * The legacy single-gateway settings (`claudeGatewayUrl` and friends) remain
 * the wire form older clients use; the server mirrors them to and from the
 * default entry.
 */

import { isEffortLevel } from "./gateway-model-effort.js";
import type { EffortLevel } from "./types.js";

export const MAX_GATEWAY_SERVICES = 16;
export const MAX_GATEWAY_SERVICE_ID_LENGTH = 32;
export const MAX_GATEWAY_SERVICE_LABEL_LENGTH = 60;
export const MAX_GATEWAY_SERVICE_SHORT_NAME_LENGTH = 16;
export const MAX_GATEWAY_SERVICE_COMMAND_LENGTH = 10_000;
export const MAX_GATEWAY_SERVICE_URL_LENGTH = 2_000;

/** Token ceilings a declared window may state. Generous, not model-specific. */
export const MAX_GATEWAY_SERVICE_CONTEXT_TOKENS = 100_000_000;
export const MAX_GATEWAY_SERVICE_OUTPUT_TOKENS = 10_000_000;
/**
 * How many models one service contributes when its entry states no limit.
 * copilot-api alone advertises roughly sixty, so the cap exists to keep a
 * model menu usable rather than to ration anything.
 */
export const DEFAULT_GATEWAY_SERVICE_MODEL_LIMIT = 100;
/** Upper bound for a per-service catalog truncation. */
export const MAX_GATEWAY_SERVICE_MODEL_LIMIT = 1_000;

/** Id carried by the entry that mirrors the legacy single-gateway settings. */
export const DEFAULT_GATEWAY_SERVICE_ID = "default";

/** Idle seconds before an auto-stop entry is asked to stop. */
export const DEFAULT_GATEWAY_AUTO_STOP_SECONDS = 300;
export const MIN_GATEWAY_AUTO_STOP_SECONDS = 0;
export const MAX_GATEWAY_AUTO_STOP_SECONDS = 86_400;

/**
 * Separator between a service id and a model id when two services advertise
 * the same model. `/` is unusable: a vLLM server with no `--served-model-name`
 * advertises the full Hugging Face repo id, which already contains one.
 */
export const GATEWAY_MODEL_ID_SEPARATOR = "::";

/**
 * Codex wire API for an endpoint. Current Codex releases accept only
 * `responses` and refuse to load a profile that says `chat`
 * ("`wire_api = \"chat\"` is no longer supported", codex-cli 0.154.0), so
 * `chat` remains selectable only for an older CLI.
 */
export type GatewayServiceCodexWireApi = "chat" | "responses";
export const DEFAULT_GATEWAY_SERVICE_CODEX_WIRE_API: GatewayServiceCodexWireApi =
  "responses";

export interface GatewayService {
  /** Stable slug. Survives relabeling; referenced by qualified model ids. */
  id: string;
  /** Display name. Empty means "derive one from the URL". */
  label: string;
  /**
   * Compact name for places that show where a model runs next to the model
   * itself — chips, model menus, session headers. Empty falls back to the id,
   * which is already a short slug.
   */
  shortName: string;
  /** Base URL of the OpenAI/Anthropic-compatible server. */
  url: string;
  /** Disabled entries keep their configuration but contribute no models. */
  enabled: boolean;
  /**
   * Optional command invoked as `<command> start|status|stop`. Loopback URLs
   * only; a non-loopback entry may not carry one.
   */
  serviceCommand?: string;
  /** Ask the command to stop once no live session uses this service. */
  autoStop: boolean;
  /** Idle seconds before that stop request, and before the stop is verified. */
  autoStopAfterSeconds: number;
  /** Launch narrowings; undefined inherits the server-wide setting. */
  disableAgent?: boolean;
  disablePlanMode?: boolean;
  /**
   * Declared window for models this service serves. Configuration is
   * authoritative: an advertised `max_model_len` or catalog limit only
   * prefills these and warns on disagreement.
   */
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  /**
   * Keep at most this many models from this service's catalog, in the order it
   * advertises them. For an endpoint that lists far more than anyone selects.
   */
  maxModels?: number;
  /**
   * Thinking-effort levels the models this service serves accept, for an
   * endpoint whose catalog states none — an OpenAI-compatible row normally
   * says nothing about reasoning. Configuration is authoritative, so a stated
   * list also overrides what a row does advertise.
   */
  effortLevels?: EffortLevel[];
  /**
   * The level the endpoint applies to a request that states none. Meaningful
   * only alongside `effortLevels`, and must be one of them.
   */
  defaultEffortLevel?: EffortLevel;
  /** Whether CodexOSS may launch against this service. */
  codexEnabled: boolean;
  /** Codex wire API for this endpoint when CodexOSS uses it. */
  codexWireApi: GatewayServiceCodexWireApi;
}

const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code < 32 || code === 127)) return true;
  }
  return false;
}

export function isValidGatewayServiceId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= MAX_GATEWAY_SERVICE_ID_LENGTH &&
    SERVICE_ID_PATTERN.test(id)
  );
}

export function isValidGatewayServiceLabel(label: string): boolean {
  return (
    label.length <= MAX_GATEWAY_SERVICE_LABEL_LENGTH &&
    label.trim() === label &&
    !containsControlCharacter(label)
  );
}

/**
 * An `http(s)` base URL with no credentials, query, or fragment — the same
 * shape the single-gateway setting has always accepted.
 */
export function normalizeGatewayServiceUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_GATEWAY_SERVICE_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const normalized = url.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/u;

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * The loopback hostname a URL names, or null when it names anything else.
 *
 * This is the boundary for every lifecycle action: YA starts, stops, and
 * signals a service only when it is demonstrably on this host. Exact
 * `localhost` / `localhost.`, IPv4 `127.0.0.0/8`, and IPv6 `::1` qualify; a
 * name that merely resolves to loopback does not, because resolution can
 * change under the check.
 */
export function loopbackGatewayHostname(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (hostname === "localhost" || hostname === "localhost.") return hostname;
  if (IPV4_PATTERN.test(hostname) && hostname.split(".")[0] === "127") {
    return hostname;
  }
  if (hostname === "::1") return hostname;
  return null;
}

export function isLoopbackGatewayUrl(rawUrl: string): boolean {
  return loopbackGatewayHostname(rawUrl) !== null;
}

export function isValidGatewayServiceCommand(command: string): boolean {
  return (
    command.length > 0 &&
    command.length <= MAX_GATEWAY_SERVICE_COMMAND_LENGTH &&
    !command.includes("\0")
  );
}

function positiveTokenCount(value: unknown, max: number): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= max
    ? value
    : undefined;
}

export function isValidGatewayServiceShortName(shortName: string): boolean {
  return (
    shortName.length <= MAX_GATEWAY_SERVICE_SHORT_NAME_LENGTH &&
    shortName.trim() === shortName &&
    !/\s/u.test(shortName) &&
    !containsControlCharacter(shortName)
  );
}

/**
 * Compact "where it runs" name, for a chip shown beside a model id. Falls back
 * to the id, which is a short slug by construction.
 */
export function gatewayServiceShortName(service: GatewayService): string {
  return service.shortName || service.id;
}

/** A display name for an entry that carries no label. */
export function gatewayServiceDisplayName(service: GatewayService): string {
  if (service.label) return service.label;
  try {
    const url = new URL(service.url);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return service.id;
  }
}

/** Where YA writes the provider-CLI exports; resolved by the server. */
export interface GatewayServiceExportPaths {
  /** `$CODEX_HOME`, or `~/.codex`. */
  codexHome: string;
  /** `$CLAUDE_CONFIG_DIR`, or `~/.claude`. */
  claudeHome: string;
}

/** The Codex profile name for a service: `codex -p <name>`. */
export function codexProfileName(service: Pick<GatewayService, "id">): string {
  return `ya-${service.id}`;
}

function joinPath(directory: string, name: string): string {
  const separator =
    directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return directory.endsWith(separator)
    ? `${directory}${name}`
    : `${directory}${separator}${name}`;
}

export function codexProfilePath(
  paths: GatewayServiceExportPaths,
  service: Pick<GatewayService, "id">,
): string {
  return joinPath(paths.codexHome, `${codexProfileName(service)}.config.toml`);
}

export function claudeSettingsPath(
  paths: GatewayServiceExportPaths,
  service: Pick<GatewayService, "id">,
): string {
  return joinPath(paths.claudeHome, `ya-${service.id}.settings.json`);
}

/**
 * The exact commands that reach a service from a terminal once the export is
 * enabled. Shown verbatim in settings, so they must stay runnable as written.
 */
export function gatewayServiceCliInvocations(
  service: Pick<GatewayService, "id" | "codexEnabled">,
  paths: GatewayServiceExportPaths,
): { claude: string; codex?: string } {
  return {
    claude: `claude --settings ${claudeSettingsPath(paths, service)}`,
    ...(service.codexEnabled
      ? { codex: `codex -p ${codexProfileName(service)}` }
      : {}),
  };
}

/** `<serviceId>::<modelId>`, used only when services collide on a model id. */
export function qualifiedGatewayModelId(
  serviceId: string,
  modelId: string,
): string {
  return `${serviceId}${GATEWAY_MODEL_ID_SEPARATOR}${modelId}`;
}

/**
 * Split a qualified model id. Returns null for a bare id, including one that
 * merely contains the separator without a configured service id in front.
 */
export function parseGatewayModelId(
  id: string,
  isKnownServiceId: (serviceId: string) => boolean,
): { serviceId: string; modelId: string } | null {
  const index = id.indexOf(GATEWAY_MODEL_ID_SEPARATOR);
  if (index <= 0) return null;
  const serviceId = id.slice(0, index);
  const modelId = id.slice(index + GATEWAY_MODEL_ID_SEPARATOR.length);
  if (!modelId || !isValidGatewayServiceId(serviceId)) return null;
  return isKnownServiceId(serviceId) ? { serviceId, modelId } : null;
}

/**
 * Parse the persisted/wire representation. Strict: one malformed entry
 * rejects the whole list rather than silently dropping a service the user
 * believes is configured.
 */
export function parseGatewayServices(value: unknown): GatewayService[] | null {
  if (!Array.isArray(value) || value.length > MAX_GATEWAY_SERVICES) return null;

  const seen = new Set<string>();
  const services: GatewayService[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || !isValidGatewayServiceId(record.id)) {
      return null;
    }
    if (seen.has(record.id)) return null;
    if (typeof record.url !== "string") return null;
    const url = normalizeGatewayServiceUrl(record.url);
    if (!url) return null;

    const label = record.label === undefined ? "" : record.label;
    if (typeof label !== "string" || !isValidGatewayServiceLabel(label)) {
      return null;
    }

    const shortName = record.shortName === undefined ? "" : record.shortName;
    if (
      typeof shortName !== "string" ||
      !isValidGatewayServiceShortName(shortName)
    ) {
      return null;
    }

    let serviceCommand: string | undefined;
    if (record.serviceCommand !== undefined && record.serviceCommand !== "") {
      if (
        typeof record.serviceCommand !== "string" ||
        !isValidGatewayServiceCommand(record.serviceCommand.trim())
      ) {
        return null;
      }
      serviceCommand = record.serviceCommand.trim();
    }

    if (record.enabled !== undefined && typeof record.enabled !== "boolean") {
      return null;
    }
    if (record.autoStop !== undefined && typeof record.autoStop !== "boolean") {
      return null;
    }
    if (
      record.disableAgent !== undefined &&
      typeof record.disableAgent !== "boolean"
    ) {
      return null;
    }
    if (
      record.disablePlanMode !== undefined &&
      typeof record.disablePlanMode !== "boolean"
    ) {
      return null;
    }
    if (
      record.codexEnabled !== undefined &&
      typeof record.codexEnabled !== "boolean"
    ) {
      return null;
    }
    if (
      record.codexWireApi !== undefined &&
      record.codexWireApi !== "chat" &&
      record.codexWireApi !== "responses"
    ) {
      return null;
    }

    let autoStopAfterSeconds = DEFAULT_GATEWAY_AUTO_STOP_SECONDS;
    if (record.autoStopAfterSeconds !== undefined) {
      if (
        typeof record.autoStopAfterSeconds !== "number" ||
        !Number.isInteger(record.autoStopAfterSeconds) ||
        record.autoStopAfterSeconds < MIN_GATEWAY_AUTO_STOP_SECONDS ||
        record.autoStopAfterSeconds > MAX_GATEWAY_AUTO_STOP_SECONDS
      ) {
        return null;
      }
      autoStopAfterSeconds = record.autoStopAfterSeconds;
    }

    if (
      record.contextWindowTokens !== undefined &&
      positiveTokenCount(
        record.contextWindowTokens,
        MAX_GATEWAY_SERVICE_CONTEXT_TOKENS,
      ) === undefined
    ) {
      return null;
    }
    if (
      record.maxOutputTokens !== undefined &&
      positiveTokenCount(
        record.maxOutputTokens,
        MAX_GATEWAY_SERVICE_OUTPUT_TOKENS,
      ) === undefined
    ) {
      return null;
    }
    if (
      record.maxModels !== undefined &&
      positiveTokenCount(record.maxModels, MAX_GATEWAY_SERVICE_MODEL_LIMIT) ===
        undefined
    ) {
      return null;
    }

    let effortLevels: EffortLevel[] | undefined;
    if (record.effortLevels !== undefined) {
      if (
        !Array.isArray(record.effortLevels) ||
        record.effortLevels.length === 0 ||
        !record.effortLevels.every(isEffortLevel) ||
        new Set(record.effortLevels).size !== record.effortLevels.length
      ) {
        return null;
      }
      effortLevels = record.effortLevels;
    }
    if (
      record.defaultEffortLevel !== undefined &&
      (!isEffortLevel(record.defaultEffortLevel) ||
        !effortLevels?.includes(record.defaultEffortLevel))
    ) {
      return null;
    }

    seen.add(record.id);
    services.push({
      id: record.id,
      label,
      shortName,
      url,
      enabled: record.enabled ?? true,
      ...(serviceCommand ? { serviceCommand } : {}),
      autoStop: record.autoStop ?? false,
      autoStopAfterSeconds,
      ...(record.disableAgent === undefined
        ? {}
        : { disableAgent: record.disableAgent }),
      ...(record.disablePlanMode === undefined
        ? {}
        : { disablePlanMode: record.disablePlanMode }),
      ...(record.contextWindowTokens === undefined
        ? {}
        : { contextWindowTokens: record.contextWindowTokens as number }),
      ...(record.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: record.maxOutputTokens as number }),
      ...(record.maxModels === undefined
        ? {}
        : { maxModels: record.maxModels as number }),
      ...(effortLevels ? { effortLevels } : {}),
      ...(record.defaultEffortLevel === undefined
        ? {}
        : { defaultEffortLevel: record.defaultEffortLevel as EffortLevel }),
      codexEnabled: record.codexEnabled ?? false,
      codexWireApi:
        record.codexWireApi ?? DEFAULT_GATEWAY_SERVICE_CODEX_WIRE_API,
    });
  }

  return services;
}
