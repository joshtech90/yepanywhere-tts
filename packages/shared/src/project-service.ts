import { z } from "zod";

const hasControlCharacters = (value: string) =>
  Array.from(value).some((character) => character.charCodeAt(0) < 32);

const relativePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !/[\\:]/.test(value) &&
      !hasControlCharacters(value) &&
      value
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            part.toLowerCase() !== ".git",
        ),
  );
const directory = z.union([z.literal("."), relativePath]);
const appPath = z
  .string()
  .max(4096)
  .refine((value) => {
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      /[\\ ?#]/.test(value) ||
      hasControlCharacters(value)
    )
      return false;
    try {
      return decodeURIComponent(value)
        .split("/")
        .every((part) => part !== ".." && part !== ".");
    } catch {
      return false;
    }
  });

/** Source-owned service declaration; observed state and hostnames live in YA data. */
export const projectServiceSchema = z.union([
  z.strictObject({
    version: z.literal(1),
    where: z.strictObject({
      kind: z.literal("static"),
      root: directory,
      entry: relativePath,
    }),
    serving: z.strictObject({ target: z.literal("static-root") }),
  }),
  z.strictObject({
    version: z.literal(1),
    where: z.strictObject({
      kind: z.literal("process"),
      cwd: directory,
      entry: appPath,
    }),
    start: z.strictObject({
      argv: z
        .array(
          z
            .string()
            .min(1)
            .max(8192)
            .refine((value) => !value.includes("\0")),
        )
        .min(1)
        .max(64),
      portEnv: z
        .string()
        .regex(/^(?:PORT|[A-Z][A-Z0-9_]*_PORT)$/)
        .refine((value) => !/^(?:YA_|YEP_|AGENT_)/.test(value)),
    }),
    status: z.strictObject({
      probe: z.literal("http"),
      path: appPath,
      readyStatus: z.number().int().min(200).max(299),
      startupTimeoutMs: z.number().int().min(100).max(120_000),
    }),
    stop: z.strictObject({
      signal: z.literal("SIGTERM"),
      graceMs: z.number().int().min(100).max(30_000),
    }),
    serving: z.strictObject({
      target: z.literal("sandbox-loopback"),
      protocol: z.literal("http"),
      basePathEnv: z
        .string()
        .regex(/^(?:BASE_PATH|[A-Z][A-Z0-9_]*_BASE_PATH)$/)
        .refine((value) => !/^(?:YA_|YEP_|AGENT_)/.test(value))
        .optional(),
    }),
  }),
]);

export type ProjectServiceDeclaration = z.infer<typeof projectServiceSchema>;

export interface ProjectAppInfo {
  /** Explicit template dev service; gated by project-live-preview. */
  livePreview?: ProjectServiceDeclaration;
  mode?: "app" | "live-preview";
  projectId: string;
  declaration: ProjectServiceDeclaration | null;
  state:
    | "none"
    | "ready"
    | "missing"
    | "stopped"
    | "starting"
    | "running"
    | "stopping"
    | "failed"
    | "unavailable";
  error?: string;
  generation?: string;
  /** ISO timestamp of the static entry or process runtime; omitted when unknown. */
  updatedAt?: string;
  activeDeclaration?: ProjectServiceDeclaration;
  restartRequired?: boolean;
  latestArtifact: {
    id: string;
    label: string;
    sessionId?: string;
    associatedAt: string;
  } | null;
  canExecute: boolean;
  /**
   * Whether this principal may start the declared service. A view grant is
   * enough to start it; stopping still needs `canExecute`. Absent from older
   * servers, where `canExecute` governs both.
   */
  canStart?: boolean;
  canPublish: boolean;
  canShare: boolean;
  /** UI share/copy permission; viewing remains authorized independently. */
  canCopyLink?: boolean;
  removedFrom: Array<{ username: string; at: string }>;
}

export interface ProjectAppInventory {
  projects: Array<{
    projectId: string;
    name: string;
    path: string;
    owner?: string;
    info: ProjectAppInfo;
  }>;
  /** Retained claims also include unavailable projects and previous namespaces. */
  reservations: Array<{
    projectId: string;
    namespace: string;
    name: string;
    owner: string;
  }>;
}

export interface ProjectAppView {
  id: string;
  kind: "static" | "artifact" | "service";
  url: string;
  expiresAt?: number;
  label: string;
  /** A viewer URL grants transferable access; it is not the authenticated project route. */
  transferable: true;
}

export interface ProjectAppAddresses {
  enabled: boolean;
  namespace: string | null;
  requiredPrefix: string;
  canReserve: boolean;
  canPublish: boolean;
  /** Absent on older servers, where only administrators canPublish. */
  canRelease?: boolean;
  reservations: Array<{
    namespace: string;
    name: string;
    owner: string;
    serving: boolean;
    public: boolean;
    privateOnly: boolean;
    reservedAt: string;
    /** Transferable current-namespace link; advertised by project-app-address-links. */
    url?: string;
  }>;
}
