import {
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  acquireClientQueryBootstrapSlot,
  type ClientQueryBootstrapSlot,
} from "../lib/clientQueryBootstrap";
import {
  useClientSummarySourceKey,
  type ClientSummarySourceKey,
} from "../lib/clientSummarySourceKey";
import { useI18n } from "../i18n";
import { ErrorBoundary } from "./ErrorBoundary";
import { StartupShell } from "./StartupShell";

function RouteModuleReady({ settle }: { settle: () => void }) {
  // This sibling commits after the selected page's hooks register their work.
  useEffect(settle, [settle]);
  return null;
}

export function RouteModule({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const sourceKey = useClientSummarySourceKey();
  const readySource = useRef<ClientSummarySourceKey | null>(null);
  const hold = useRef<ClientQueryBootstrapSlot | null>(null);
  const settle = useCallback(() => {
    readySource.current = sourceKey;
    hold.current?.settle();
  }, [sourceKey]);

  useEffect(() => {
    // A lazy page can mount a commit later than the shell's fast queries.
    // Reserve its route priority while suspended, retaining the tier deadline.
    if (readySource.current === sourceKey) return;
    const slot = acquireClientQueryBootstrapSlot(sourceKey, "route");
    hold.current = slot;
    return () => {
      slot.settle();
      if (hold.current === slot) hold.current = null;
    };
  }, [sourceKey]);

  return (
    <ErrorBoundary>
      <Suspense
        fallback={<StartupShell phase="module">{t("loading")}</StartupShell>}
      >
        {children}
        <RouteModuleReady settle={settle} />
      </Suspense>
    </ErrorBoundary>
  );
}

export function routeModule(element: ReactNode) {
  return <RouteModule>{element}</RouteModule>;
}
