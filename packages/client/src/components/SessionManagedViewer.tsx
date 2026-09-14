import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
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
  children,
}: {
  sessionId: string;
  inactive?: boolean;
  onSendComment?: SendSessionViewerComment;
  children: ReactNode;
}) {
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const viewerId = useId();
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
          {children}
          <SessionManagedViewerHost sessionId={sessionId} inactive={inactive} />
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
  const viewerOpen = Boolean(
    controller?.sessionId === sessionId && !controller.minimized,
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
}: {
  sessionId: string;
  inactive?: boolean;
}) {
  const controller = useSessionViewerController();
  const controllerRef = useRef(controller);
  const lifecycleGenerationRef = useRef(0);
  controllerRef.current = controller;
  const panel =
    controller?.kind === "panel" && controller.sessionId === sessionId
      ? controller
      : null;
  const file =
    controller?.kind === "file" &&
    controller.sessionId === sessionId &&
    controller.renderContent
      ? controller
      : null;

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

  if (file) return file.renderContent(inactive);
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
