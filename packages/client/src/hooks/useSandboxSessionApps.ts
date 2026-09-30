import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import type { Message } from "../types";
import {
  type SessionAppConfig,
  sessionToolUrls,
  unmappedLoopbackPorts,
} from "../lib/sessionVhostApps";

type SessionApps = NonNullable<SessionAppConfig["sessionApps"]>;

/**
 * Minted app names for the loopback servers a firewalled sandboxed session
 * announced in its tool output. Its loopback is private to its sandbox, so a
 * printed `http://127.0.0.1:<port>` would otherwise lead nowhere; YA reaches
 * it through the sandbox's port broker (topics/session-right-pane.md
 * § Sandboxed session apps). Each port is asked about once per session; a
 * refusal is remembered, not retried on every render.
 */
export function useSandboxSessionApps(options: {
  projectId: string;
  sessionId: string;
  messages: readonly Message[];
  config: SessionAppConfig | undefined;
  /** The session's live process runs behind the sandbox firewall. */
  firewalled: boolean;
  active: boolean;
}): SessionApps | undefined {
  const { projectId, sessionId, messages, config, firewalled, active } =
    options;
  const transport = useCurrentSourceRuntime().transport;
  const [apps, setApps] = useState<{ sessionId: string; apps: SessionApps }>();
  const asked = useRef<{ sessionId: string; ports: Set<number> } | null>(null);
  const ports = useMemo(() => {
    if (!active || !firewalled || !config) return [];
    return unmappedLoopbackPorts(messages.flatMap(sessionToolUrls), config);
  }, [active, firewalled, config, messages]);

  useEffect(() => {
    if (asked.current?.sessionId !== sessionId) {
      asked.current = { sessionId, ports: new Set() };
    }
    const pending = ports.filter((port) => !asked.current?.ports.has(port));
    // An answer is kept even if more ports arrive meanwhile: each port is
    // asked once, so dropping it would lose it. One for a session no longer
    // shown is keyed to that session and never returned for another.
    for (const port of pending) {
      asked.current.ports.add(port);
      transport
        .fetch<{ name: string; accessToken: string }>(
          `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/sandbox-apps`,
          { method: "POST", body: JSON.stringify({ port }) },
        )
        .then(
          (app) => {
            setApps((previous) => ({
              sessionId,
              apps: {
                ...(previous?.sessionId === sessionId ? previous.apps : {}),
                [port]: app,
              },
            }));
          },
          // No sandbox broker, apps unconfigured, or not this user's to open:
          // the URL stays an ordinary transcript link.
          () => {},
        );
    }
  }, [ports, projectId, sessionId, transport]);

  return apps?.sessionId === sessionId ? apps.apps : undefined;
}
