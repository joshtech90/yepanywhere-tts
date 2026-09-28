import { createContext, useContext, useMemo } from "react";
import type { SessionAppConfig } from "../lib/sessionVhostApps";
import type { Message } from "../types";
import { sessionToolUrls, sessionVhostApp } from "../lib/sessionVhostApps";
import styles from "./SessionAppLinks.module.css";

export const SessionAppLinkContext = createContext<{
  config?: SessionAppConfig;
  open?: (url: string) => boolean;
  rewriteHref?: (url: string) => string;
  publicHref?: (url: string) => string | undefined;
  /** Record a viewer-activated app URL as the session's latest App. */
  announce?: (url: string, label: string) => void;
} | null>(null);

const preserveHref = (url: string) => url;
const noPublicHref = () => undefined;

/** Announce an app the reader started from a viewer, or no-op outside a session. */
export function useSessionAppAnnouncer(): (url: string, label: string) => void {
  const announce = useContext(SessionAppLinkContext)?.announce;
  return announce ?? noAnnounce;
}
const noAnnounce = () => {};

/** Rewrite a transcript link through the current session's app-link policy. */
export function useSessionAppLinkRewriter(): (url: string) => string {
  return useContext(SessionAppLinkContext)?.rewriteHref ?? preserveHref;
}

/** Resolve a public URL for an explicit copy action, independent of auto-rewrite. */
export function useSessionAppPublicHref(): (url: string) => string | undefined {
  return useContext(SessionAppLinkContext)?.publicHref ?? noPublicHref;
}

/**
 * Rewrite only anchor destinations in trusted rendered transcript HTML.
 * The no-rewriter default returns the HTML without parsing it.
 */
export function rewriteSessionAppLinksHtml(
  html: string,
  rewriteHref: (url: string) => string,
): string {
  if (
    rewriteHref === preserveHref ||
    typeof document === "undefined" ||
    !/href/i.test(html)
  )
    return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  let changed = false;
  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>(
    "a[href]",
  )) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    const rewritten = rewriteHref(href);
    if (rewritten === href) continue;
    anchor.setAttribute("href", rewritten);
    changed = true;
  }
  return changed ? template.innerHTML : html;
}

/** Apply the current session's link policy to rendered transcript HTML. */
export function useSessionAppLinksHtml(html: string): string {
  const rewriteHref = useSessionAppLinkRewriter();
  return useMemo(
    () => rewriteSessionAppLinksHtml(html, rewriteHref),
    [html, rewriteHref],
  );
}

/** Display-only links: provider transcript bytes remain unchanged. */
export function SessionAppLinks({
  messages,
}: {
  messages: readonly Message[];
}) {
  const context = useContext(SessionAppLinkContext);
  if (!context) return null;
  const apps = new Map<
    string,
    NonNullable<ReturnType<typeof sessionVhostApp>>
  >();
  for (const message of messages) {
    for (const raw of sessionToolUrls(message)) {
      const app = sessionVhostApp(raw, context.config, window.location.href);
      if (app) apps.set(app.url, app);
    }
  }
  if (!apps.size) return null;
  return (
    <div className={styles.links}>
      {[...apps.values()].map((app) => (
        <a
          key={app.url}
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.stopPropagation();
            if (
              context.open &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              if (context.open(app.url)) event.preventDefault();
            }
          }}
        >
          {app.label} ↗
        </a>
      ))}
    </div>
  );
}
