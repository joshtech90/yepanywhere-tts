export interface ArtifactConfig {
  port: number;
  localOrigin?: string;
  publicOrigin?: string;
  /** Days a new link lives; the stored and transported unit. */
  expiryDays?: number;
  /** Derived from days, so an older client keeps its hours control. */
  expiryHours?: number;
  /** Default ownership for a grant that does not state one. */
  deleteOnExpiry?: boolean;
}

/** A week is long enough to open a link again, short enough to forget. */
export const DEFAULT_ARTIFACT_EXPIRY_DAYS = 7;
export const MAX_ARTIFACT_EXPIRY_DAYS = 30;
/** An earlier install stored hours; its ceiling was a week. */
const MAX_LEGACY_EXPIRY_HOURS = 168;

export function validateArtifactConfig(
  value: unknown,
  defaultExpiryDays = DEFAULT_ARTIFACT_EXPIRY_DAYS,
  defaultDeleteOnExpiry = false,
): ArtifactConfig {
  if (!value || typeof value !== "object")
    throw new Error("Artifact configuration must be an object");
  const input = value as Record<string, unknown>;
  // Days win when both are present; an hours-only writer is an older client
  // or a settings file saved before days existed, and is rounded up so its
  // lifetime never silently shortens.
  let expiryDays = input.expiryDays;
  if (expiryDays === undefined && input.expiryHours !== undefined) {
    const hours = input.expiryHours;
    if (
      typeof hours !== "number" ||
      !Number.isInteger(hours) ||
      hours < 1 ||
      hours > MAX_LEGACY_EXPIRY_HOURS
    )
      throw new Error("Artifact expiry must be whole hours from 1 to 168");
    expiryDays = Math.ceil(hours / 24);
  }
  if (expiryDays === undefined) expiryDays = defaultExpiryDays;
  if (
    typeof expiryDays !== "number" ||
    !Number.isInteger(expiryDays) ||
    expiryDays < 1 ||
    expiryDays > MAX_ARTIFACT_EXPIRY_DAYS
  )
    throw new Error(
      `Artifact expiry must be whole days from 1 to ${MAX_ARTIFACT_EXPIRY_DAYS}`,
    );
  const deleteOnExpiry =
    input.deleteOnExpiry === undefined
      ? defaultDeleteOnExpiry
      : input.deleteOnExpiry;
  if (typeof deleteOnExpiry !== "boolean")
    throw new Error("Artifact deleteOnExpiry must be true or false");
  if (
    typeof input.port !== "number" ||
    !Number.isInteger(input.port) ||
    input.port < 1 ||
    input.port > 65535
  )
    throw new Error("Artifact port must be from 1 to 65535");
  for (const key of ["localOrigin", "publicOrigin"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "string")
      throw new Error(`${key} must be a URL or an empty string`);
  }
  const env = {
    YEP_ARTIFACT_PORT: String(input.port),
    YEP_ARTIFACT_LOCAL_ORIGIN: input.localOrigin as string | undefined,
    YEP_ARTIFACT_PUBLIC_ORIGIN: input.publicOrigin as string | undefined,
  };
  const config = readArtifactConfig(env);
  if (!config) throw new Error("Artifact port must be from 1 to 65535");
  return {
    ...config,
    expiryDays,
    expiryHours: expiryDays * 24,
    deleteOnExpiry,
  };
}

export function readArtifactConfig(
  env: NodeJS.ProcessEnv,
): ArtifactConfig | undefined {
  if (!env.YEP_ARTIFACT_PORT) return;
  // An explicit launch-time disable overrides persisted origins as well.
  if (env.YEP_ARTIFACT_PORT === "0") return { port: 4402 };
  const port = Number(env.YEP_ARTIFACT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "YEP_ARTIFACT_PORT must be an integer from 1 to 65535 (0 disables serving)",
    );
  }
  const config: ArtifactConfig = { port };
  for (const [key, name] of [
    ["localOrigin", "YEP_ARTIFACT_LOCAL_ORIGIN"],
    ["publicOrigin", "YEP_ARTIFACT_PUBLIC_ORIGIN"],
  ] as const) {
    const value = env[name];
    if (!value) continue;
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      (key === "publicOrigin" && url.protocol !== "https:")
    ) {
      throw new Error(
        `${name} must be a separate artifact origin without a path; public origins require HTTPS`,
      );
    }
    config[key] = url.origin;
  }
  return config;
}
