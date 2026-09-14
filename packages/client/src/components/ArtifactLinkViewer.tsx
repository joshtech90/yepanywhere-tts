import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import type { SessionViewerControllerState } from "../lib/sessionViewerController";
import {
  useModalBackGesture,
  useModalBackspace,
  useModalLayer,
} from "./ui/Modal";
import styles from "./ArtifactLinkViewer.module.css";

export function ArtifactLinkViewer({
  controller,
  inactive,
}: {
  controller: Extract<SessionViewerControllerState, { kind: "artifact" }>;
  inactive: boolean;
}) {
  const { t } = useI18n();
  const hidden = inactive || controller.minimized;
  const closeRef = useRef<HTMLButtonElement>(null);
  const [blocked, setBlocked] = useState(false);
  useModalBackGesture(controller.close, !hidden, "__artifactViewer");
  useModalBackspace(controller.close, !hidden);
  useModalLayer(controller.close, !hidden);
  useEffect(() => {
    if (!hidden) closeRef.current?.focus();
  }, [hidden]);
  useEffect(() => {
    const origin = new URL(controller.url).origin;
    const onViolation = (event: SecurityPolicyViolationEvent) => {
      if (
        event.disposition === "enforce" &&
        event.effectiveDirective === "frame-src" &&
        (event.blockedURI === origin ||
          event.blockedURI.startsWith(`${origin}/`))
      )
        setBlocked(true);
    };
    document.addEventListener("securitypolicyviolation", onViolation);
    return () =>
      document.removeEventListener("securitypolicyviolation", onViolation);
  }, [controller.url]);
  const layer =
    document.querySelector<HTMLElement>(
      ".navigation-route-layer.is-active [data-session-viewer-layer]",
    ) ?? document.querySelector<HTMLElement>("[data-session-viewer-layer]");
  if (!layer) return null;
  return createPortal(
    <section
      className={styles.viewer}
      role="dialog"
      aria-label={controller.label}
      hidden={hidden}
    >
      <header className={styles.header}>
        <span className={styles.title}>{controller.label}</span>
        <button
          type="button"
          onClick={controller.minimize}
          aria-label={t("modalMinimize")}
        >
          −
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={controller.close}
          aria-label={t("modalClose")}
        >
          ×
        </button>
      </header>
      {blocked ? (
        <p role="alert" className={styles.notice}>
          {t("artifactLinkFrameBlocked")}
        </p>
      ) : (
        <iframe
          className={styles.frame}
          title={controller.label}
          src={controller.url}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
        />
      )}
    </section>,
    layer,
  );
}
