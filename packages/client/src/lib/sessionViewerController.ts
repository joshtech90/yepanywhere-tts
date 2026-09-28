import type { ReactNode, RefObject } from "react";
import { useSyncExternalStore } from "react";
import type { MessageKey } from "../i18n";
import { sessionViewerUsesRightPane } from "./sessionViewerPlacement";

/**
 * What the viewer toolbar's trailing button does, whatever the viewer is.
 *
 * A viewer that dismisses itself gets the default below; one whose dismissal
 * costs something — stopping an app, say — installs its own descriptor with
 * `setSessionViewerCloseAction`. Readers render this and never ask what kind
 * of viewer they are showing.
 */
export interface SessionViewerCloseAction {
  label: MessageKey;
  destructive?: boolean;
  busy?: boolean;
  run: () => void;
}

interface SessionViewerBase {
  id: string;
  sessionId: string;
  label: string;
  briefLabel?: string;
  closeAction?: SessionViewerCloseAction;
}

export interface PanelViewerRegistration extends SessionViewerBase {
  kind: "panel";
  onClose: () => void;
  title: ReactNode;
  actions?: ReactNode;
  contentRef?: RefObject<HTMLDivElement | null>;
  content: ReactNode;
}

interface FileViewerBase extends SessionViewerBase {
  kind: "file";
  filePath: string;
  lineSuffix: string;
  supportsRightPane?: boolean;
}

export type FileViewerRegistration = FileViewerBase &
  (
    | { onClose: () => void; renderContent?: never }
    | {
        onClose?: () => void;
        renderContent: (inactive: boolean, rightPane?: boolean) => ReactNode;
      }
  );

export type SessionViewerRegistration =
  | PanelViewerRegistration
  | (SessionViewerBase & {
      kind: "vhost";
      url: string;
      onClose?: never;
      artifactToken?: string;
    })
  | (SessionViewerBase & { kind: "artifact"; url: string; onClose?: never })
  | FileViewerRegistration;

export type SessionViewerControllerState = SessionViewerRegistration & {
  close: () => void;
  minimize: () => void;
  minimized: boolean;
  restore: () => void;
};

let current: SessionViewerControllerState | null = null;
const listeners = new Set<() => void>();
let resumeRevision = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

export function sessionViewerFreezesTranscript(
  state: SessionViewerControllerState | null,
): boolean {
  return Boolean(
    state &&
      state.kind !== "artifact" &&
      !sessionViewerUsesRightPane(state) &&
      !state.minimized,
  );
}

function frozenTranscriptSessionId(
  state: SessionViewerControllerState | null,
): string | null {
  if (!state || !sessionViewerFreezesTranscript(state)) return null;
  return state.sessionId;
}

function replaceCurrent(next: SessionViewerControllerState | null): void {
  const previousFrozenSessionId = frozenTranscriptSessionId(current);
  const nextFrozenSessionId = frozenTranscriptSessionId(next);
  if (
    previousFrozenSessionId &&
    previousFrozenSessionId !== nextFrozenSessionId
  ) {
    resumeRevision += 1;
  }
  current = next;
  emit();
}

export function closeSessionViewer(id: string): void {
  if (current?.id !== id) return;
  const onClose = current.onClose;
  replaceCurrent(null);
  onClose?.();
}

function setMinimized(id: string, minimized: boolean): void {
  if (current?.id !== id || current.minimized === minimized) return;
  replaceCurrent({ ...current, minimized });
}

export function minimizeSessionViewer(id: string): void {
  setMinimized(id, true);
}

export function restoreSessionViewer(id: string): void {
  setMinimized(id, false);
}

/**
 * A viewer that has said nothing about dismissal simply closes. A vhost is the
 * exception: stopping the app it shows is the owning session's decision, so its
 * button stays absent until that owner installs one.
 */
function defaultCloseAction(
  registration: SessionViewerRegistration,
  close: () => void,
): SessionViewerCloseAction | undefined {
  if (registration.kind === "vhost") return undefined;
  return {
    label:
      registration.kind === "file" ? "fileViewerClose" : "sessionViewerClose",
    run: close,
  };
}

function toController(
  registration: SessionViewerRegistration,
  minimized: boolean,
): SessionViewerControllerState {
  const { id } = registration;
  const close = () => closeSessionViewer(id);
  return {
    ...registration,
    closeAction:
      registration.closeAction ?? defaultCloseAction(registration, close),
    close,
    minimize: () => setMinimized(id, true),
    minimized,
    restore: () => setMinimized(id, false),
  };
}

/**
 * Present or update the session's one managed viewer.
 *
 * Replacing a different viewer dismisses its source while an update to the
 * same viewer preserves its parked/open state and mounted host identity.
 */
export function presentSessionViewer(
  registration: SessionViewerRegistration,
): void {
  const previous = current;
  const minimized = previous?.id === registration.id && previous.minimized;
  replaceCurrent(toController(registration, Boolean(minimized)));
  if (previous && previous.id !== registration.id) previous.onClose?.();
}

export function clearSessionViewer(id: string): void {
  if (current?.id !== id) return;
  replaceCurrent(null);
}

function sameCloseAction(
  a: SessionViewerCloseAction | undefined,
  b: SessionViewerCloseAction | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.run === b.run &&
    a.label === b.label &&
    !!a.destructive === !!b.destructive &&
    !!a.busy === !!b.busy
  );
}

/**
 * Install the open viewer's dismissal descriptor.
 *
 * Owners rebuild the descriptor on every render, so an unchanged one must not
 * publish: field equality is what keeps a caller's effect from re-entering the
 * store it just changed.
 */
export function setSessionViewerCloseAction(
  id: string,
  closeAction: SessionViewerCloseAction | undefined,
): void {
  if (current?.id !== id) return;
  if (sameCloseAction(current.closeAction, closeAction)) return;
  replaceCurrent({ ...current, closeAction });
}

export function clearCurrentSessionViewer(): void {
  if (!current) return;
  replaceCurrent(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SessionViewerControllerState | null {
  return current;
}

export function useSessionViewerController(): SessionViewerControllerState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isSessionViewerTranscriptFrozen(
  sessionId: string | null,
): boolean {
  return sessionId !== null && frozenTranscriptSessionId(current) === sessionId;
}

/**
 * Notify transcript work only when a covering modal stops freezing it.
 * Opening that modal deliberately leaves the covered transcript unchanged.
 */
export function useSessionViewerResumeRevision(): number {
  return useSyncExternalStore(
    subscribe,
    () => resumeRevision,
    () => resumeRevision,
  );
}
