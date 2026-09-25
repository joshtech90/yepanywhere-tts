import { type ReactNode, useCallback, useState } from "react";
import { useI18n } from "../i18n";
import { CockpitSessionMenu } from "./CockpitSessionMenu";
import type { CockpitSessionMenuAnchor } from "./CockpitSessionRow";
import type { CockpitCatalogSession } from "./core/catalog";
import type { CockpitOrganizationController } from "./useCockpitOrganization";

export interface CockpitSessionMenuHost {
  element: ReactNode;
  open: (
    session: CockpitCatalogSession,
    anchor: CockpitSessionMenuAnchor,
  ) => void;
}

/** Owns the one open session menu of a list and its three actions. */
export function useCockpitSessionMenu(
  organization: CockpitOrganizationController,
): CockpitSessionMenuHost {
  const { t } = useI18n();
  const [target, setTarget] = useState<{
    session: CockpitCatalogSession;
    anchor: CockpitSessionMenuAnchor;
  } | null>(null);
  const open = useCallback(
    (session: CockpitCatalogSession, anchor: CockpitSessionMenuAnchor) =>
      setTarget({ session, anchor }),
    [],
  );
  const close = useCallback(() => setTarget(null), []);
  const { archiveSession, pendingPins, renameSession, togglePin } =
    organization;

  const session = target?.session;
  const element = session ? (
    <CockpitSessionMenu
      anchor={target.anchor}
      busy={pendingPins.has(session.id)}
      key={session.key}
      onArchive={() => archiveSession(session.id)}
      onClose={close}
      onRename={(title) => renameSession(session.id, title)}
      onTogglePin={() => void togglePin(session.id, !session.pinned)}
      open
      pinned={session.pinned}
      sessionTitle={session.title || t("cockpitUntitledSession")}
    />
  ) : null;

  return { element, open };
}
