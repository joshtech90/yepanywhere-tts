import { useRef } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useI18n } from "../i18n";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";
import { useCockpitComposer } from "./useCockpitComposer";
import styles from "./CockpitComposer.module.css";

export interface CockpitComposerProps {
  projectId: string;
  sessionId: string;
  sessionPort: CockpitComposerSessionPort;
}

function actionLabel(
  action: "send" | "steer" | "queue",
  t: ReturnType<typeof useI18n>["t"],
) {
  if (action === "steer") return t("toolbarSteerTooltip").split("\n")[0];
  if (action === "queue") return t("toolbarQueueLabel");
  return t("toolbarSend");
}

function CockpitComposerSession(props: CockpitComposerProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composer = useCockpitComposer(
    props.projectId,
    props.sessionId,
    props.sessionPort,
  );
  const hasBlockedAttachment = composer.attachments.some(
    (attachment) => attachment.status !== "ready",
  );
  const canSubmit =
    !composer.submitting &&
    !hasBlockedAttachment &&
    (composer.draft.trim().length > 0 || composer.attachments.length > 0);

  return (
    <section className={styles.root} aria-label={t("sessionPlaceholderResume")}>
      {composer.attachments.length > 0 && (
        <ul className={styles.attachments}>
          {composer.attachments.map((attachment) => (
            <li key={attachment.id} data-status={attachment.status}>
              <span className={styles.fileMark} aria-hidden="true">
                +
              </span>
              <span className={styles.fileName} title={attachment.name}>
                {attachment.name}
              </span>
              {attachment.status === "uploading" && (
                <span className={styles.fileStatus}>{attachment.progress}%</span>
              )}
              {attachment.status === "failed" && (
                <>
                  <span className={styles.fileError} title={attachment.error}>
                    {attachment.error}
                  </span>
                  <button
                    onClick={() => composer.retryAttachment(attachment.id)}
                    type="button"
                  >
                    {t("cockpitSessionRetry")}
                  </button>
                </>
              )}
              <button
                aria-label={t("attachmentRemove", { name: attachment.name })}
                onClick={() => composer.removeAttachment(attachment.id)}
                type="button"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.composerBox}>
        <textarea
          aria-label={t("sessionPlaceholderResume")}
          onChange={(event) => composer.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit) void composer.submit();
            }
          }}
          placeholder={t(
            composer.actions.busy
              ? "sessionPlaceholderQueue"
              : "sessionPlaceholderResume",
          )}
          rows={2}
          value={composer.draft}
        />
        <div className={styles.actions}>
          <input
            className={styles.fileInput}
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) composer.attachFiles(files);
              event.target.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <button
            aria-label={t("toolbarAttachFiles")}
            className={styles.attachButton}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            +
          </button>
          <span className={styles.hint}>{t("toolbarSendTooltip")}</span>
          {composer.actions.canQueue && composer.actions.primary !== "queue" && (
            <button
              className={styles.secondaryAction}
              disabled={!canSubmit}
              onClick={() => void composer.submit("queue")}
              type="button"
            >
              {t("toolbarQueueLabel")}
            </button>
          )}
          <button
            className={styles.primaryAction}
            disabled={!canSubmit}
            onClick={() => void composer.submit()}
            type="button"
          >
            {composer.submitting
              ? t("pushToggleSending")
              : actionLabel(composer.actions.primary, t)}
          </button>
        </div>
      </div>

      {composer.error && (
        <p className={styles.error} role="alert">
          {composer.error}
        </p>
      )}
    </section>
  );
}

export function CockpitComposer(props: CockpitComposerProps) {
  const runtime = useCurrentSourceRuntime();
  const composerKey = JSON.stringify([
    runtime.sourceKey,
    props.projectId,
    props.sessionId,
  ]);

  return <CockpitComposerSession key={composerKey} {...props} />;
}
