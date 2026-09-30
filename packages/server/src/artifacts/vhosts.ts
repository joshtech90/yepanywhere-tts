import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

export interface ArtifactVhost {
  name: string;
  port: number;
  /** Optional child-env name; value is the decimal port. */
  env?: string;
  public?: boolean;
}

/** A vhost serving one file or directory itself; see `VhostSiteServer`. */
export interface ArtifactVhostSite {
  name: string;
  /** Absolute path, home-expanded when saved. */
  path: string;
  public?: boolean;
  /**
   * `scrypt$<salt>$<hash>` of the visitor password; without a link, a
   * visitor must supply it. Never sent to a client.
   */
  passwordHash?: string;
}

export const MAX_ARTIFACT_VHOSTS = 32;
const PASSWORD_HASH = /^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;
const MAX_PASSWORD_BYTES = 1024;

export function hashVhostPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 32).toString("base64url")}`;
}

/** Checks off the event loop: scrypt is deliberately slow. */
export async function vhostPasswordMatches(
  hash: string,
  password: string,
): Promise<boolean> {
  const [, salt, expected] = hash.split("$");
  if (!salt || !expected || Buffer.byteLength(password) > MAX_PASSWORD_BYTES)
    return false;
  const actual = await new Promise<Buffer>((resolve, reject) =>
    scrypt(password, Buffer.from(salt, "base64url"), 32, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
  const wanted = Buffer.from(expected, "base64url");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
/**
 * Label prefix of the names YA mints for sandboxed session apps. Operator rows
 * are not forbidden from it, since persisted rows predate it: a static row
 * always matches first, and minting skips any name a row uses.
 */
export const SESSION_APP_NAME_PREFIX = "sbx-";
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

/** A file row as clients see it: whether a password is set, never its hash. */
export function clientVhostSite({
  passwordHash,
  ...site
}: ArtifactVhostSite): Omit<ArtifactVhostSite, "passwordHash"> & {
  passwordProtected?: true;
} {
  return passwordHash ? { ...site, passwordProtected: true } : site;
}

/** Every name a configured row, port or file, holds. */
export function configuredVhostNames(config: {
  vhosts?: readonly Pick<ArtifactVhost, "name">[];
  vhostSites?: readonly Pick<ArtifactVhostSite, "name">[];
}): string[] {
  return [...(config.vhosts ?? []), ...(config.vhostSites ?? [])].map(
    (row) => row.name,
  );
}

/**
 * A vhost name no new claim may take: the labels YA's own hosts use, and the
 * prefixes of the names it mints for session and project apps.
 */
export function vhostNameReserved(name: string): boolean {
  return RESERVED_VHOST_NAMES.has(name) || /^(?:app-|sbx-)/.test(name);
}

/**
 * File and directory vhost rows. Names are DNS labels unique across these and
 * the port rows (`portRows`); an absent list keeps `previous`, so a client that
 * predates these rows never drops them by saving port rows.
 */
export function parseVhostSites(
  value: unknown,
  portRows: readonly ArtifactVhost[],
  previous?: readonly ArtifactVhostSite[],
  expandPath: (path: string) => string = (path) => path,
): ArtifactVhostSite[] {
  if (value === undefined) value = previous ?? [];
  if (!Array.isArray(value)) throw new Error("Vhost sites must be a list");
  if (value.length + portRows.length > MAX_ARTIFACT_VHOSTS)
    throw new Error(`At most ${MAX_ARTIFACT_VHOSTS} vhost mappings`);
  const names = new Set(portRows.map((row) => row.name));
  const sites: ArtifactVhostSite[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object")
      throw new Error("Each vhost site must be an object");
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== "string")
      throw new Error("Vhost name must be a DNS label");
    const name = row.name.trim().toLowerCase();
    const known = previous?.some((site) => site.name === name);
    // Earlier rows keep their names; a new one may not take a reserved label.
    if (!VHOST_LABEL.test(name) || (!known && vhostNameReserved(name)))
      throw new Error(`Invalid vhost name "${row.name}"`);
    if (names.has(name)) throw new Error(`Duplicate vhost name "${name}"`);
    names.add(name);
    if (typeof row.path !== "string" || !row.path.trim())
      throw new Error(`Vhost "${name}" needs a file or directory path`);
    const path = expandPath(row.path.trim());
    if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path))
      throw new Error(`Vhost "${name}" path must be absolute or start with ~`);
    if (row.public !== undefined && typeof row.public !== "boolean")
      throw new Error("Vhost public access must be true or false");
    // `password` sets (a string) or clears (empty or null) the visitor
    // password; absent keeps the saved one. A stored hash is accepted as is,
    // which is how a settings file carries it.
    let passwordHash: string | undefined;
    if (typeof row.password === "string" && row.password) {
      if (Buffer.byteLength(row.password) > MAX_PASSWORD_BYTES)
        throw new Error(`Vhost "${name}" password is too long`);
      passwordHash = hashVhostPassword(row.password);
    } else if (row.password === undefined) {
      if (row.passwordHash !== undefined) {
        if (
          typeof row.passwordHash !== "string" ||
          !PASSWORD_HASH.test(row.passwordHash)
        )
          throw new Error(`Vhost "${name}" has an invalid password hash`);
        passwordHash = row.passwordHash;
      } else {
        passwordHash = previous?.find(
          (site) => site.name === name,
        )?.passwordHash;
      }
    } else if (row.password !== "" && row.password !== null) {
      throw new Error(`Vhost "${name}" password must be text`);
    }
    sites.push({
      name,
      path,
      ...(row.public ? { public: true } : {}),
      ...(passwordHash ? { passwordHash } : {}),
    });
  }
  return sites;
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
  vhosts: readonly Pick<ArtifactVhost, "name">[],
  publicRoot?: string,
): string[] {
  const hosts: string[] = [];
  for (const { name } of vhosts) {
    hosts.push(`${name}.localhost`);
    if (publicRoot) hosts.push(`${name}.${publicRoot}`);
  }
  return hosts;
}

export function matchVhost<Row extends { name: string }>(
  host: string | undefined,
  vhosts: readonly Row[],
  publicRoot?: string,
): Row | undefined {
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
