import { createContext, useContext } from "react";
import type { SessionAppConfig } from "../lib/sessionVhostApps";
import type { Message } from "../types";
import { sessionToolUrls, sessionVhostApp } from "../lib/sessionVhostApps";
import styles from "./SessionAppLinks.module.css";

export const SessionAppLinkContext = createContext<{
  config?: SessionAppConfig;
  open?: (url: string) => boolean;
} | null>(null);

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
