import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useOptionalToastContext } from "../contexts/ToastContext";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { beginTooltipSuppression } from "../hooks/useTooltipAppearance";
import { useRetainedVersionInfo, useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import { toBrowserAppHref } from "../lib/appHref";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import { downloadBlob } from "../lib/imageActions";
import { isMarkdownLikeFile } from "../lib/markdownFiles";
import {
  createNewSessionPrefillToken,
  setNewSessionPrefill,
  stashNewSessionPrefillToken,
  type NewSessionPrefillCaret,
} from "../lib/newSessionPrefill";
import styles from "./FileResourceActions.module.css";

export type FileViewPresentation = "preview" | "source";

export function supportsSourceAndPreview(
  filePath: string,
  renderMarkdown = false,
): boolean {
  return (
    renderMarkdown ||
    isMarkdownLikeFile(filePath) ||
    /\.(?:html?|xhtml)$/i.test(filePath)
  );
}

/**
 * What the resource menu's Download row saves: bytes the client fetches, or
 * a URL the browser downloads itself.
 */
export type ResourceDownload =
  | { fileName: string; loadBlob: () => Promise<Blob> }
  | { url: string };

export interface ResourceContextMenuProps {
  x: number;
  y: number;
  canStartNewSession?: boolean;
  dismissLabel?: string;
  onClose: () => void;
  onCopyAbsolutePath?: () => void;
  onCopyContents?: () => void;
  onCopyRenderedContents?: () => void;
  onCopyFilePath?: () => void;
  onCopyImage?: () => void;
  onCopyProjectRelativePath?: () => void;
  onCopyPublicUrl?: () => void;
  onCopyViewerLink?: () => void;
  download?: ResourceDownload;
  /** An outside path whose checkout or directory may open in a new tab. */
  localSource?: LocalSourceTarget;
  onOpen: () => void;
  onOpenPreview?: () => void;
  onOpenSource?: () => void;
  onStartNewSession?: () => void;
  /** A running preview's stop action, shown last with `stopLabel`. */
  onStop?: () => void;
  stopLabel?: string;
}

export interface NewSessionPrefillOptions {
  caret?: NewSessionPrefillCaret;
  executor?: string;
  model?: string;
  newTab?: boolean;
  permissionMode?: string;
  provider?: string;
  thinking?: string;
}

function appendNewSessionOptionParams(
  params: URLSearchParams,
  options: NewSessionPrefillOptions,
): void {
  if (options.provider) params.set("provider", options.provider);
  if (options.model) params.set("model", options.model);
  if (options.thinking) params.set("thinking", options.thinking);
  if (options.permissionMode) {
    params.set("permissionMode", options.permissionMode);
  }
  if (options.executor) params.set("executor", options.executor);
}

function navigateInTab(url: string): void {
  window.history.pushState(window.history.state, "", url);
  const navigationEvent =
    typeof PopStateEvent === "function"
      ? new PopStateEvent("popstate", { state: window.history.state })
      : new Event("popstate");
  window.dispatchEvent(navigationEvent);
}

export function useStartNewSessionWithPrefillAction() {
  const basePath = useRemoteBasePath();
  const clientSummarySourceKey = useClientSummarySourceKey();

  return useCallback(
    (
      projectId: string,
      prefill: string,
      options: NewSessionPrefillOptions = {},
    ) => {
      const trimmed = prefill.trim();
      if (!projectId || !trimmed) return;
      const params = new URLSearchParams({ projectId });
      appendNewSessionOptionParams(params, options);
      if (options.newTab) {
        const token = createNewSessionPrefillToken();
        params.set("prefillToken", token);
        const opened = window.open(
          `${basePath}/new-session?${params.toString()}`,
          "_blank",
        );
        if (opened) {
          opened.opener = null;
          stashNewSessionPrefillToken(token, clientSummarySourceKey, trimmed, {
            caret: options.caret,
          });
          return;
        }
        params.delete("prefillToken");
      }
      setNewSessionPrefill(clientSummarySourceKey, trimmed, {
        caret: options.caret,
      });
      navigateInTab(`${basePath}/new-session?${params.toString()}`);
    },
    [basePath, clientSummarySourceKey],
  );
}

const HOST_PATH = /^(?:\/(?!\/)|~\/|[A-Za-z]:[\\/])/;

/**
 * Start a session about a file in the project that owns it. A host path may
 * belong to a different project than the conversation it was linked from; the
 * server resolves ownership, including symlinked roots, and the session opens
 * there with the project-relative path. A file inside no project, a failed
 * lookup, or an older server keeps the linking project and the path as
 * written, so the prefill never names a project it was not proven to be in.
 */
export function useStartNewSessionFromFileAction() {
  const startNewSession = useStartNewSessionWithPrefillAction();
  const sourceKey = useClientSummarySourceKey();
  const version = useRetainedVersionInfo(sourceKey);
  const canResolveOwner = serverHasCapability(
    version,
    SERVER_CAPABILITIES.fileOwnerProject.name,
  );
  return useCallback(
    (projectId: string, filePath: string) => {
      if (!canResolveOwner || !HOST_PATH.test(filePath)) {
        startNewSession(projectId, filePath);
        return;
      }
      void api
        .getFileOwner(projectId, filePath)
        .then(({ owner }) =>
          owner
            ? startNewSession(owner.projectId, owner.relativePath)
            : startNewSession(projectId, filePath),
        )
        .catch(() => startNewSession(projectId, filePath));
    },
    [canResolveOwner, startNewSession],
  );
}

export function useStartNewSessionFromFile(
  projectId: string,
  filePath: string,
) {
  const startNewSession = useStartNewSessionFromFileAction();
  return useCallback(() => {
    startNewSession(projectId, filePath);
  }, [filePath, projectId, startNewSession]);
}

/** An absolute path outside `projectId` that Source Control can browse. */
export interface LocalSourceTarget {
  projectId: string;
  path: string;
}

/**
 * The target for a path's menu: absolute, outside the project, and not in a
 * public share. Deciding this needs no server state, so links stay free of
 * version lookups until a menu actually opens.
 */
export function localSourceTarget(
  projectId: string,
  absolutePath: string | null,
  projectRelativePath: string | null,
  inPublicShare: boolean,
): LocalSourceTarget | undefined {
  return !inPublicShare && !projectRelativePath && absolutePath
    ? { projectId, path: absolutePath }
    : undefined;
}

/**
 * Opens the target's checkout or directory in a new tab of Source Control's
 * current-files browser. Mounted only inside an open menu, so the capability
 * lookup costs nothing for the many links that are never right-clicked; it
 * renders nothing on a server without `local-source-browse`.
 */
function OpenLocalSourceMenuItem({
  target,
  onHover,
  select,
}: {
  target: LocalSourceTarget;
  onHover?: () => void;
  select: (action: () => void) => void;
}) {
  const { t } = useI18n();
  const basePath = useRemoteBasePath();
  const { version } = useVersion();
  if (!serverHasCapability(version, SERVER_CAPABILITIES.localSourceBrowse.name))
    return null;
  const open = () => {
    const params = new URLSearchParams({ path: target.path });
    window.open(
      toBrowserAppHref(
        `${basePath}/projects/${target.projectId}/browse?${params.toString()}`,
      ),
      "_blank",
      "noopener",
    );
  };
  return (
    <FilePathContextMenuItem onHover={onHover} onSelect={() => select(open)}>
      {t("fileLinkMenuOpenInSourceControl" as never)}
    </FilePathContextMenuItem>
  );
}

/**
 * Saves a resource menu download. Fetched bytes go under `fileName`, and a
 * failed fetch is reported: the menu has closed by the time the fetch settles,
 * so the reason goes to an error toast. A URL is handed to the browser, whose
 * own download UI reports its failures.
 */
function useSaveResourceDownload() {
  const { t } = useI18n();
  const showToast = useOptionalToastContext()?.showToast;
  return (download: ResourceDownload) => {
    if ("url" in download) {
      const anchor = document.createElement("a");
      anchor.href = download.url;
      anchor.click();
      return;
    }
    const { fileName, loadBlob } = download;
    void loadBlob()
      .then((blob) => downloadBlob(blob, fileName))
      .catch((error: unknown) => {
        showToast?.(
          t("resourceDownloadFailed" as never, {
            fileName,
            reason: error instanceof Error ? error.message : String(error),
          }),
          "error",
        );
      });
  };
}

function FilePathContextMenuItem({
  children,
  expanded = false,
  onHover,
  onSelect,
  opensPanel = false,
}: {
  children: ReactNode;
  expanded?: boolean;
  onHover?: () => void;
  onSelect: () => void;
  opensPanel?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup={opensPanel ? "menu" : undefined}
      aria-expanded={opensPanel ? expanded : undefined}
      className={expanded ? styles.activeItem : undefined}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      {children}
    </button>
  );
}

function BranchLabel({ children }: { children: ReactNode }) {
  return (
    <span className={styles.branchLabel}>
      <span>{children}</span>
      <span aria-hidden="true">›</span>
    </span>
  );
}

function BackLabel({ children }: { children: ReactNode }) {
  return (
    <span className={styles.backLabel}>
      <span aria-hidden="true">‹</span>
      <span>{children}</span>
    </span>
  );
}

function CopyActionLabel({ children }: { children: ReactNode }) {
  return (
    <span className={styles.copyActionLabel}>
      <CopyIcon />
      <span>{children}</span>
    </span>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

export function ResourceContextMenu({
  x,
  y,
  canStartNewSession = true,
  dismissLabel,
  onClose,
  onCopyAbsolutePath,
  onCopyContents,
  onCopyRenderedContents,
  onCopyFilePath,
  onCopyImage,
  onCopyProjectRelativePath,
  onCopyPublicUrl,
  onCopyViewerLink,
  download,
  localSource,
  onOpen,
  onOpenPreview,
  onOpenSource,
  onStartNewSession,
  onStop,
  stopLabel,
}: ResourceContextMenuProps) {
  const { t } = useI18n();
  const saveDownload = useSaveResourceDownload();
  const [panel, setPanel] = useState<"open" | "root">("root");
  const hasPresentationChoice = Boolean(onOpenSource && onOpenPreview);
  const hasCopyActions = Boolean(
    onCopyProjectRelativePath ||
      onCopyPublicUrl ||
      onCopyAbsolutePath ||
      onCopyFilePath ||
      onCopyImage ||
      onCopyViewerLink ||
      onCopyContents ||
      onCopyRenderedContents,
  );
  const usesHoverFlyout =
    window.innerWidth >= 520 &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const rootItemCount =
    1 +
    Number(Boolean(download)) +
    Number(Boolean(canStartNewSession && onStartNewSession)) +
    Number(Boolean(localSource)) +
    Number(Boolean(onCopyImage)) +
    Number(Boolean(onCopyProjectRelativePath)) +
    Number(Boolean(onCopyPublicUrl)) +
    Number(Boolean(onCopyAbsolutePath)) +
    Number(Boolean(onCopyFilePath)) +
    Number(Boolean(onCopyViewerLink)) +
    Number(Boolean(onCopyContents)) +
    Number(Boolean(onCopyRenderedContents));

  // The right-click that opened this menu came from a link that was almost
  // certainly showing its hover tooltip, and the pointer then holds still — so
  // without this the tooltip sits over the menu's first entries until the
  // reader moves far enough to shake it off.
  useEffect(() => beginTooltipSuppression(), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const select = (action: () => void) => {
    action();
    onClose();
  };

  const rootMenuLeft = Math.max(8, Math.min(x, window.innerWidth - 230));
  const rootMenuHeight =
    16 + rootItemCount * (usesHoverFlyout ? 36 : 44) + (hasCopyActions ? 9 : 0);
  const rootMenuTop = Math.max(
    8,
    Math.min(y, window.innerHeight - rootMenuHeight),
  );
  const estimatedSubmenuHeight = 180;
  const submenuTop = usesHoverFlyout
    ? Math.max(
        8,
        Math.min(rootMenuTop, window.innerHeight - estimatedSubmenuHeight),
      )
    : Math.max(8, Math.min(y, window.innerHeight - estimatedSubmenuHeight));
  const canOpenSubmenuRight = rootMenuLeft + 218 + 230 <= window.innerWidth;
  const submenuLeft = usesHoverFlyout
    ? canOpenSubmenuRight
      ? rootMenuLeft + 218
      : Math.max(8, rootMenuLeft - 218)
    : rootMenuLeft;
  const renderRootPanel = panel === "root" || usesHoverFlyout;

  return createPortal(
    <>
      <button
        type="button"
        className={styles.overlay}
        aria-label={dismissLabel ?? t("fileLinkDismissMenu" as never)}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      {renderRootPanel ? (
        <div
          className={styles.menu}
          role="menu"
          style={{ left: rootMenuLeft, top: rootMenuTop }}
        >
          <FilePathContextMenuItem
            expanded={panel === "open"}
            opensPanel={hasPresentationChoice}
            onHover={
              usesHoverFlyout && hasPresentationChoice
                ? () => setPanel("open")
                : undefined
            }
            onSelect={() =>
              hasPresentationChoice ? setPanel("open") : select(onOpen)
            }
          >
            {hasPresentationChoice ? (
              <BranchLabel>{t("fileLinkMenuOpen" as never)}</BranchLabel>
            ) : (
              t("fileLinkMenuOpen" as never)
            )}
          </FilePathContextMenuItem>
          {download ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(() => saveDownload(download))}
            >
              {t("resourceMenuDownload" as never)}
            </FilePathContextMenuItem>
          ) : null}
          {canStartNewSession && onStartNewSession ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(onStartNewSession)}
            >
              {t("fileLinkMenuNewSession" as never)}
            </FilePathContextMenuItem>
          ) : null}
          {localSource ? (
            <OpenLocalSourceMenuItem
              target={localSource}
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              select={select}
            />
          ) : null}
          {hasCopyActions ? <div className={styles.separator} /> : null}
          {onCopyImage ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(onCopyImage)}
            >
              <CopyActionLabel>
                {t("fileLinkMenuCopyImage" as never)}
              </CopyActionLabel>
            </FilePathContextMenuItem>
          ) : null}
          {onCopyProjectRelativePath ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(onCopyProjectRelativePath)}
            >
              <CopyActionLabel>
                {t("fileLinkMenuCopyProjectRelativePath" as never)}
              </CopyActionLabel>
            </FilePathContextMenuItem>
          ) : null}
          {onCopyPublicUrl ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(onCopyPublicUrl)}
            >
              <CopyActionLabel>
                {t("fileLinkMenuCopyPublicUrl" as never)}
              </CopyActionLabel>
            </FilePathContextMenuItem>
          ) : null}
          {onCopyAbsolutePath ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(onCopyAbsolutePath)}
            >
              <CopyActionLabel>
                {t("fileLinkMenuCopyAbsolutePath" as never)}
              </CopyActionLabel>
            </FilePathContextMenuItem>
          ) : null}
          {onCopyFilePath ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(onCopyFilePath)}
            >
              <CopyActionLabel>
                {t("fileLinkMenuCopyFilePath" as never)}
              </CopyActionLabel>
            </FilePathContextMenuItem>
          ) : null}
          {onCopyViewerLink ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(onCopyViewerLink)}
            >
              <CopyActionLabel>
                {t("fileLinkMenuCopyViewerLink" as never)}
              </CopyActionLabel>
            </FilePathContextMenuItem>
          ) : null}
          {onCopyContents ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(onCopyContents)}
            >
              <CopyActionLabel>
                {t("fileLinkMenuCopyContents" as never)}
              </CopyActionLabel>
            </FilePathContextMenuItem>
          ) : null}
          {onCopyRenderedContents ? (
            <FilePathContextMenuItem
              onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
              onSelect={() => select(onCopyRenderedContents)}
            >
              <CopyActionLabel>
                {t("fileLinkMenuCopyRenderedContents" as never)}
              </CopyActionLabel>
            </FilePathContextMenuItem>
          ) : null}
          {onStop && stopLabel ? (
            <>
              <div className={styles.separator} />
              <FilePathContextMenuItem
                onHover={usesHoverFlyout ? () => setPanel("root") : undefined}
                onSelect={() => select(onStop)}
              >
                {stopLabel}
              </FilePathContextMenuItem>
            </>
          ) : null}
        </div>
      ) : null}
      {panel !== "root" ? (
        <div
          aria-label={t("fileLinkMenuOpen" as never)}
          className={`${styles.menu} ${styles.submenu}`}
          role="menu"
          style={{ left: submenuLeft, top: submenuTop }}
        >
          {!usesHoverFlyout ? (
            <>
              <FilePathContextMenuItem onSelect={() => setPanel("root")}>
                <BackLabel>{t("fileLinkMenuBack" as never)}</BackLabel>
              </FilePathContextMenuItem>
              <div className={styles.separator} />
            </>
          ) : null}
          {onOpenSource ? (
            <FilePathContextMenuItem onSelect={() => select(onOpenSource)}>
              {t("fileViewerSource" as never)}
            </FilePathContextMenuItem>
          ) : null}
          {onOpenPreview ? (
            <FilePathContextMenuItem onSelect={() => select(onOpenPreview)}>
              {t("fileViewerPreview" as never)}
            </FilePathContextMenuItem>
          ) : null}
        </div>
      ) : null}
    </>,
    document.body,
  );
}

/** File-oriented compatibility name for existing call sites. */
export const FilePathContextMenu = ResourceContextMenu;
