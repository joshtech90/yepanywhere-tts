import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useSessionRightPaneSetting } from "../hooks/useSessionRightPaneSetting";
import { usePanelSlideAnimations } from "../hooks/usePanelSlideAnimations";
import { useClosingPaneContent } from "../hooks/useClosingPaneContent";
import { sessionViewerUsesRightPane } from "../lib/sessionViewerPlacement";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useRetainedVersionInfo } from "../hooks/useVersion";
import { isArtifactLink } from "../lib/artifactPreview";
import { ArtifactLinkViewer } from "./ArtifactLinkViewer";
import {
  type SendSessionViewerComment,
  SessionViewerCommentProvider,
} from "../contexts/SessionViewerCommentContext";
import {
  clearSessionViewer,
  presentSessionViewer,
  restoreSessionViewer,
  useSessionViewerController,
} from "../lib/sessionViewerController";
import { Modal } from "./ui/Modal";
import { SessionAppLinkContext } from "./SessionAppLinks";
import type { SessionAppConfig } from "../lib/sessionVhostApps";

interface SessionManagedPanelProps {
  viewerId?: string;
  sessionId: string;
  title: ReactNode;
  actions?: ReactNode;
  contentRef?: RefObject<HTMLDivElement | null>;
  label: string;
  briefLabel?: string;
  children: ReactNode;
  onClose: () => void;
}

const SessionViewerContext = createContext<string | null>(null);
const SessionFileViewerHostContext = createContext<{
  target: HTMLElement | null;
  inactive: boolean;
} | null>(null);

export function useSessionFileViewerHost() {
  return useContext(SessionFileViewerHostContext);
}
const SessionArtifactLinkContext = createContext<
  ((url: string, label: string) => boolean) | null
>(null);

export function useSessionArtifactLink() {
  return useContext(SessionArtifactLinkContext);
}

export function useSessionViewerSessionId(): string | null {
  return useContext(SessionViewerContext);
}

/** Publishes a content panel to the session's shared managed-viewer host. */
export function SessionManagedPanel({
  viewerId: suppliedViewerId,
  sessionId,
  title,
  actions,
  contentRef,
  label,
  briefLabel,
  children,
  onClose,
}: SessionManagedPanelProps) {
  const generatedViewerId = useId();
  const viewerId = suppliedViewerId ?? generatedViewerId;
  const mountedRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    presentSessionViewer({
      id: viewerId,
      kind: "panel",
      sessionId,
      title,
      actions,
      contentRef,
      label,
      briefLabel,
      content: children,
      onClose: () => {
        if (mountedRef.current) onCloseRef.current();
      },
    });
  }, [
    actions,
    briefLabel,
    children,
    contentRef,
    label,
    sessionId,
    title,
    viewerId,
  ]);

  return null;
}

export function SessionViewerProvider({
  sessionId,
  inactive = false,
  onSendComment,
  onOpenApp,
  appConfig,
  rightPaneTarget,
  children,
}: {
  sessionId: string;
  inactive?: boolean;
  onSendComment?: SendSessionViewerComment;
  onOpenApp?: (url: string) => boolean;
  appConfig?: SessionAppConfig;
  rightPaneTarget?: HTMLElement | null;
  children: ReactNode;
}) {
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const viewerId = useId();
  const appLinks = useMemo(
    () => (inactive ? null : { config: appConfig, open: onOpenApp }),
    [inactive, appConfig, onOpenApp],
  );
  const openArtifact = useCallback(
    (url: string, label: string) => {
      if (
        inactive ||
        !isArtifactLink(url, version?.artifactViewer, window.location.href)
      )
        return false;
      presentSessionViewer({
        id: viewerId,
        kind: "artifact",
        sessionId,
        url,
        label,
      });
      restoreSessionViewer(viewerId);
      return true;
    },
    [inactive, sessionId, version?.artifactViewer, viewerId],
  );
  return (
    <SessionViewerContext.Provider value={sessionId}>
      <SessionArtifactLinkContext.Provider value={openArtifact}>
        <SessionViewerCommentProvider onSendComment={onSendComment}>
          <SessionAppLinkContext.Provider value={appLinks}>
            {children}
          </SessionAppLinkContext.Provider>
          <SessionManagedViewerHost
            sessionId={sessionId}
            inactive={inactive}
            rightPaneTarget={rightPaneTarget}
          />
        </SessionViewerCommentProvider>
      </SessionArtifactLinkContext.Provider>
    </SessionViewerContext.Provider>
  );
}

/** Keeps covered transcript props stable while its managed viewer is open. */
export function SessionViewerTranscriptGate({
  children,
}: {
  children: ReactNode;
}) {
  const sessionId = useSessionViewerSessionId();
  const controller = useSessionViewerController();
  useSessionRightPaneSetting();
  const viewerOpen = Boolean(
    controller?.sessionId === sessionId &&
      !sessionViewerUsesRightPane(controller) &&
      !controller.minimized,
  );
  const renderedChildrenRef = useRef(children);
  if (!viewerOpen) {
    renderedChildrenRef.current = children;
  }
  return renderedChildrenRef.current;
}

export function SessionManagedViewerHost({
  sessionId,
  inactive = false,
  rightPaneTarget,
}: {
  sessionId: string;
  inactive?: boolean;
  rightPaneTarget?: HTMLElement | null;
}) {
  const controller = useSessionViewerController();
  const { sessionRightPaneEnabled } = useSessionRightPaneSetting();
  const { panelSlideDurationMs } = usePanelSlideAnimations();
  const controllerRef = useRef(controller);
  const lifecycleGenerationRef = useRef(0);
  controllerRef.current = controller;
  const panel =
    controller?.kind === "panel" && controller.sessionId === sessionId
      ? controller
      : null;
  const activeFile =
    controller?.kind === "file" &&
    controller.sessionId === sessionId &&
    controller.renderContent
      ? controller
      : null;
  const file = useClosingPaneContent(
    activeFile,
    sessionRightPaneEnabled && (!controller || activeFile)
      ? panelSlideDurationMs
      : 0,
  );

  useEffect(() => {
    lifecycleGenerationRef.current += 1;
    return () => {
      const cleanupGeneration = lifecycleGenerationRef.current + 1;
      lifecycleGenerationRef.current = cleanupGeneration;
      queueMicrotask(() => {
        const active = controllerRef.current;
        if (
          lifecycleGenerationRef.current === cleanupGeneration &&
          active?.sessionId === sessionId
        ) {
          clearSessionViewer(active.id);
        }
      });
    };
  }, [sessionId]);

  if (file) {
    const content = (
      <SessionViewerContext.Provider value={null}>
        <SessionFileViewerHostContext.Provider
          value={{
            target: sessionViewerUsesRightPane(file)
              ? (rightPaneTarget ?? null)
              : null,
            inactive: inactive || file.minimized || controller?.id !== file.id,
          }}
        >
          {file.renderContent(inactive, sessionViewerUsesRightPane(file))}
        </SessionFileViewerHostContext.Provider>
      </SessionViewerContext.Provider>
    );
    if (sessionViewerUsesRightPane(file)) {
      if (!rightPaneTarget) return null;
      return createPortal(content, rightPaneTarget);
    }
    return content;
  }
  if (controller?.kind === "artifact" && controller.sessionId === sessionId)
    return (
      <ArtifactLinkViewer
        key={controller.url}
        controller={controller}
        inactive={inactive}
      />
    );
  if (!panel) return null;
  return (
    <Modal
      title={panel.title}
      actions={panel.actions}
      contentRef={panel.contentRef}
      onClose={panel.close}
      onMinimize={panel.minimize}
      minimized={panel.minimized || inactive}
    >
      {panel.content}
    </Modal>
  );
}
