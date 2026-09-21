export interface ArtifactVhost {
  name: string;
  port: number;
  /** Optional child-env name; value is the decimal port. */
  env?: string;
  public?: boolean;
}

export const MAX_ARTIFACT_VHOSTS = 32;
/** Names explicitly selected by the server's vhost configuration. */
export const VHOST_ENV_NAMES = "AGENT_VHOST_ENV_NAMES";

const VHOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const VHOST_ENV = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_VHOST_NAMES = new Set([
  "localhost",
  "artifacts",
  "relay",
  "www",
  "ya",
]);
const FORBIDDEN_ENV_PREFIXES = ["YEP_", "YA_"];
const FORBIDDEN_ENV_NAMES = new Set([
  VHOST_ENV_NAMES,
  "AGENTCTL_SESSION_ID",
  "AGENT_YA_API_URL",
  "AGENT_YA_API_TOKEN",
  "PATH",
  "HOME",
  "BASH_ENV",
]);

export function parseVhostPublicRoot(
  value: unknown,
  previous?: string,
): string | undefined {
  if (value === undefined) return previous;
  if (typeof value !== "string")
    throw new Error("Vhost public root must be a hostname");
  const trimmed = value.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed) return undefined;
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(":"))
    throw new Error("Vhost public root must be a hostname such as example.com");
  const labels = trimmed.split(".");
  if (labels.length < 2 || labels.some((label) => !VHOST_LABEL.test(label)))
    throw new Error("Vhost public root must be a hostname such as example.com");
  if (trimmed === "localhost" || trimmed.endsWith(".localhost"))
    throw new Error("Vhost public root cannot be localhost");
  return trimmed;
}

export function parseVhosts(
  value: unknown,
  previous?: readonly ArtifactVhost[],
): ArtifactVhost[] {
  if (value === undefined) return previous ? [...previous] : [];
  if (!Array.isArray(value)) throw new Error("Vhosts must be a list");
  if (value.length > MAX_ARTIFACT_VHOSTS)
    throw new Error(`At most ${MAX_ARTIFACT_VHOSTS} vhost mappings`);
  const names = new Set<string>();
  const envs = new Set<string>();
  const vhosts: ArtifactVhost[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object")
      throw new Error("Each vhost mapping must be an object");
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== "string")
      throw new Error("Vhost name must be a DNS label");
    const name = row.name.trim().toLowerCase();
    if (!VHOST_LABEL.test(name) || RESERVED_VHOST_NAMES.has(name))
      throw new Error(`Invalid vhost name "${row.name}"`);
    if (names.has(name)) throw new Error(`Duplicate vhost name "${name}"`);
    names.add(name);
    if (
      typeof row.port !== "number" ||
      !Number.isInteger(row.port) ||
      row.port < 1 ||
      row.port > 65535
    )
      throw new Error(`Vhost "${name}" port must be from 1 to 65535`);
    let env: string | undefined;
    if (row.env !== undefined && row.env !== "") {
      if (typeof row.env !== "string")
        throw new Error(`Vhost "${name}" env must be a variable name`);
      const envName = row.env.trim();
      if (
        !VHOST_ENV.test(envName) ||
        FORBIDDEN_ENV_NAMES.has(envName) ||
        FORBIDDEN_ENV_PREFIXES.some((prefix) => envName.startsWith(prefix))
      )
        throw new Error(`Invalid vhost env name "${row.env}"`);
      if (envs.has(envName))
        throw new Error(`Duplicate vhost env "${envName}"`);
      envs.add(envName);
      env = envName;
    }
    if (row.public !== undefined && typeof row.public !== "boolean")
      throw new Error("Vhost public access must be true or false");
    const publicAccess =
      row.public ?? previous?.find((entry) => entry.name === name)?.public;
    vhosts.push({
      name,
      port: row.port,
      ...(env ? { env } : {}),
      ...(publicAccess === undefined
        ? {}
        : { public: publicAccess as boolean }),
    });
  }
  return vhosts;
}

export function hostnameFromHostHeader(
  host: string | undefined,
): string | undefined {
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function vhostHostnames(
  vhosts: readonly ArtifactVhost[],
  publicRoot?: string,
): string[] {
  const hosts: string[] = [];
  for (const { name } of vhosts) {
    hosts.push(`${name}.localhost`);
    if (publicRoot) hosts.push(`${name}.${publicRoot}`);
  }
  return hosts;
}

export function matchVhost(
  host: string | undefined,
  vhosts: readonly ArtifactVhost[],
  publicRoot?: string,
): ArtifactVhost | undefined {
  const hostname = hostnameFromHostHeader(host);
  if (!hostname) return undefined;
  for (const vhost of vhosts) {
    if (hostname === `${vhost.name}.localhost`) return vhost;
    if (publicRoot && hostname === `${vhost.name}.${publicRoot}`) return vhost;
  }
  return undefined;
}

/**
 * Scheme the visitor's browser used to reach this vhost. A `name.localhost`
 * host is reached directly over the listener's plain HTTP; any other match is
 * a public-root host, which only arrives through the operator's tunnel, and
 * that tunnel terminates HTTPS before YA sees the request.
 */
export function vhostExternalProtocol(hostname: string): "http" | "https" {
  return hostname.endsWith(".localhost") ? "http" : "https";
}

export function vhostSessionEnvironment(
  vhosts: readonly Pick<ArtifactVhost, "env" | "port">[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const vhost of vhosts)
    if (vhost.env) env[vhost.env] = String(vhost.port);
  if (Object.keys(env).length)
    env[VHOST_ENV_NAMES] = JSON.stringify(Object.keys(env));
  return env;
}
