import type {
  ArtifactViewerStatus,
  AppContentBlock,
} from "@yep-anywhere/shared";
import type { Message } from "../types";
import { artifactAudience, isArtifactLink } from "./artifactPreview";
export type SessionAppConfig = ArtifactViewerStatus & {
  accessTokens?: Record<string, string | null>;
  /**
   * Names YA minted for this session's sandboxed loopback servers, by port.
   * An operator row for the same port always wins.
   */
  sessionApps?: Record<number, { name: string; accessToken: string }>;
};

export interface SessionVhostApp {
  sourceUrl: string;
  url: string;
  label: string;
  artifactToken?: string;
}

export interface SessionVhostLinkContext {
  clientUrl: string;
  relayed: boolean;
  force?: boolean;
}

const toolUrls = new WeakMap<Message, string[]>();

/** Discover local app URLs only in tool result text, without rescanning immutable history. */
export function sessionToolUrls(message: Message): string[] {
  const cached = toolUrls.get(message);
  if (cached) return cached;
  const urls: string[] = [];
  const content = message.message?.content ?? message.content;
  function readResult(value: string | AppContentBlock[] | undefined) {
    if (typeof value === "string") {
      for (const match of value.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)) {
        const raw = match[0].replace(/[),.;]+$/, "");
        if (/\$\{|\$%7b/i.test(raw)) continue;
        try {
          const url = new URL(raw);
          if (
            artifactAudience(url.hostname) === "local" ||
            url.pathname.startsWith("/a/")
          )
            urls.push(raw);
        } catch {
          // A URL-looking fragment in tool text need not be a valid URL.
        }
      }
    } else if (Array.isArray(value)) {
      for (const block of value) {
        if (block.type === "text") readResult(block.text);
      }
    }
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "tool_result") readResult(block.content);
    }
  }
  toolUrls.set(message, urls);
  return urls;
}

/** Rewrite a loopback tool URL through the operator's static vhost table. */
export function sessionVhostApp(
  raw: string,
  config: SessionAppConfig | undefined,
  clientUrl: string,
  audience?: "local" | "public",
): SessionVhostApp | undefined {
  // Source templates are not running-app announcements, including saved links.
  if (/\$\{|\$%7b/i.test(raw)) return;
  if (isArtifactLink(raw, config, clientUrl)) {
    const url = new URL(raw);
    return {
      sourceUrl: raw,
      url: url.href,
      label: url.pathname.split("/").at(-1)!,
      artifactToken: url.pathname.split("/")[2],
    };
  }
  if (!config?.vhosts?.length && !config?.sessionApps) return;
  let source: URL;
  try {
    source = new URL(raw);
  } catch {
    return;
  }
  if (
    source.protocol !== "http:" ||
    artifactAudience(source.hostname) !== "local" ||
    source.username ||
    source.password
  )
    return;
  const port = Number(source.port || 80);
  const staticRow = config.vhosts?.find((row) => row.port === port);
  const sessionApp = staticRow ? undefined : config.sessionApps?.[port];
  const row = staticRow ?? (sessionApp && { name: sessionApp.name });
  if (!row) return;
  const client = new URL(clientUrl);
  let target: URL;
  if ((audience ?? artifactAudience(client.hostname)) === "local") {
    if (!config.localOrigin) return;
    target = new URL(config.localOrigin);
    target.hostname = `${row.name}.localhost`;
  } else {
    if (!config.vhostPublicRoot) return;
    target = new URL(`https://${row.name}.${config.vhostPublicRoot}`);
  }
  if (
    target.hostname === client.hostname ||
    (client.protocol === "https:" && target.protocol !== "https:")
  )
    return;
  target.pathname = source.pathname;
  target.search = source.search;
  if (sessionApp) {
    target.searchParams.set("ya_access", sessionApp.accessToken);
  } else {
    const token = config.accessTokens?.[row.name];
    if (config.accessTokens && token === undefined) return;
    if (token) target.searchParams.set("ya_access", token);
  }
  target.hash = source.hash;
  return {
    sourceUrl: raw,
    url: target.href,
    // A minted name means nothing to the reader; the port they printed does.
    label: sessionApp
      ? `${source.host}${source.pathname === "/" ? "" : source.pathname}`
      : `${row.name}${source.pathname === "/" ? "" : source.pathname}`,
  };
}

/**
 * Loopback ports named by tool URLs that no operator row serves: the ports a
 * sandboxed session's own servers may be listening on.
 */
export function unmappedLoopbackPorts(
  urls: readonly string[],
  config: SessionAppConfig | undefined,
): number[] {
  const ports = new Set<number>();
  for (const raw of urls) {
    if (/\$\{|\$%7b/i.test(raw)) continue;
    let source: URL;
    try {
      source = new URL(raw);
    } catch {
      continue;
    }
    if (
      source.protocol !== "http:" ||
      artifactAudience(source.hostname) !== "local" ||
      source.hostname.endsWith(".localhost") ||
      source.username ||
      source.password
    )
      continue;
    const port = Number(source.port || 80);
    if (!config?.vhosts?.some((row) => row.port === port)) ports.add(port);
  }
  return [...ports];
}

/**
 * Whether transcript link rewriting can change any destination on this page:
 * a public root is configured, and the page is a public relay page, the
 * operator chose "always", or an explicit copy action forces it.
 */
export function sessionLocalhostRewriteApplies(
  config: SessionAppConfig | undefined,
  context: SessionVhostLinkContext,
): boolean {
  if (!config?.vhostPublicRoot) return false;
  if (context.force || config.alwaysRewriteVhostLinks) return true;
  if (!context.relayed) return false;
  try {
    return artifactAudience(new URL(context.clientUrl).hostname) === "public";
  } catch {
    return false;
  }
}

/** Rewrite a name.localhost URL through the configured public wildcard root. */
export function rewriteSessionLocalhostHref(
  raw: string,
  config: SessionAppConfig | undefined,
  context: SessionVhostLinkContext,
): string {
  if (
    !config?.vhostPublicRoot ||
    !sessionLocalhostRewriteApplies(config, context)
  )
    return raw;
  let source: URL;
  try {
    source = new URL(raw, context.clientUrl);
  } catch {
    return raw;
  }
  if (
    !["http:", "https:"].includes(source.protocol) ||
    source.username ||
    source.password ||
    !source.hostname.endsWith(".localhost")
  )
    return raw;
  const name = source.hostname.slice(0, -".localhost".length);
  if (!name) return raw;
  const configuredVhost = config.vhosts?.some((row) => row.name === name);
  const token = configuredVhost ? config.accessTokens?.[name] : undefined;
  if (configuredVhost && config.accessTokens && token === undefined) return raw;
  const target = new URL(`https://${name}.${config.vhostPublicRoot}`);
  target.pathname = source.pathname;
  target.search = source.search;
  if (token) target.searchParams.set("ya_access", token);
  target.hash = source.hash;
  return target.href;
}

/**
 * Public URL for an explicit "Copy public URL", independent of the automatic
 * rewrite choice: a forced localhost mapping, else a link already under the
 * public root. Undefined when no public destination exists.
 */
export function publicSessionLocalhostHref(
  raw: string,
  config: SessionAppConfig | undefined,
  context: SessionVhostLinkContext,
): string | undefined {
  if (!config?.vhostPublicRoot) return undefined;
  const rewritten = rewriteSessionLocalhostHref(raw, config, {
    ...context,
    force: true,
  });
  if (rewritten !== raw) return rewritten;
  try {
    const target = new URL(raw);
    if (target.hostname.endsWith(`.${config.vhostPublicRoot}`))
      return target.href;
  } catch {
    return undefined;
  }
  return undefined;
}
