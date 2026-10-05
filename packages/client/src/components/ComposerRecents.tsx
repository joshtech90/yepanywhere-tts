import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  readComposerHistory,
  subscribeComposerHistory,
  type ComposerHistory,
  type RecentComposerUpload,
} from "../lib/composerHistory";
import { MicrophoneIcon } from "./MicrophoneIcon";
import {
  placeAttachmentHoverPreview,
  type AttachmentHoverBox,
} from "../lib/attachmentHoverPreview";
import styles from "./ComposerRecents.module.css";
import { useI18n } from "../i18n";

export function ComposerRecents({
  scope,
  onFiles,
  uploadsOpen,
  onUploadsClose,
  onBrowse,
  onMemo,
  disabled = false,
  newSession = false,
}: {
  scope: string | null;
  onFiles: (files: File[]) => void;
  uploadsOpen: boolean;
  onUploadsClose: () => void;
  onBrowse: () => void;
  onMemo?: () => void;
  disabled?: boolean;
  newSession?: boolean;
}) {
  const { t } = useI18n();
  const [history, setHistory] = useState<ComposerHistory>({
    prompts: [],
    uploads: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<{
    item: RecentComposerUpload;
    box: AttachmentHoverBox;
  } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const clearPreview = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setPreview(null);
  }, []);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    if (!uploadsOpen) {
      clearPreview();
      return;
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearPreview();
        onUploadsClose();
      }
    };
    document.addEventListener("keydown", key);
    window.addEventListener("resize", clearPreview);
    window.addEventListener("scroll", clearPreview, true);
    return () => {
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", clearPreview);
      window.removeEventListener("scroll", clearPreview, true);
    };
  }, [uploadsOpen, onUploadsClose, clearPreview]);
  useEffect(() => {
    let active = true;
    setHistory({ prompts: [], uploads: [] });
    setError(null);
    clearPreview();
    let unsubscribe: (() => void) | undefined;
    if (scope && uploadsOpen && expanded) {
      const refresh = () =>
        void readComposerHistory(scope)
          .then((value) => {
            if (active) setHistory(value);
          })
          .catch((cause: unknown) => {
            if (active) setError(String(cause));
          });
      unsubscribe = subscribeComposerHistory(scope, refresh);
      refresh();
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [scope, uploadsOpen, expanded, clearPreview]);
  useEffect(() => {
    const urls = Object.fromEntries(
      history.uploads
        .filter((item) => item.file.type.startsWith("image/"))
        .map((item) => [item.id, URL.createObjectURL(item.file)]),
    );
    setPreviews(urls);
    return () => {
      for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    };
  }, [history.uploads]);
  return (
    <div className={styles.recents}>
      {uploadsOpen && (
        <div
          className={styles.gallery}
          role="region"
          aria-label={t(
            newSession ? "composerAttachNewSession" : "audioMemoShareMenu",
          )}
        >
          <div className={styles.heading}>
            <strong>
              {t(
                newSession ? "composerAttachNewSession" : "audioMemoShareMenu",
              )}
            </strong>
            <button
              type="button"
              aria-label={t("composerUploadsClose")}
              className={styles.close}
              onClick={onUploadsClose}
            >
              ×
            </button>
          </div>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <span>
              {expanded ? "▾" : "▸"} {t("composerUploadsLabel")}
            </span>
            <small>{t("composerHistoryLocal")}</small>
          </button>
          {expanded && (
            <div className={styles.tiles}>
              {history.uploads.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  disabled={disabled}
                  onMouseEnter={(event) => {
                    const img = event.currentTarget.querySelector("img");
                    if (!img?.naturalWidth) return;
                    const anchor = event.currentTarget.getBoundingClientRect();
                    clearTimeout(hoverTimer.current);
                    hoverTimer.current = setTimeout(
                      () =>
                        setPreview({
                          item,
                          box: placeAttachmentHoverPreview({
                            anchor,
                            imageWidth: img.naturalWidth,
                            imageHeight: img.naturalHeight,
                            viewportWidth: window.innerWidth,
                            viewportHeight: window.innerHeight,
                          }),
                        }),
                      450,
                    );
                  }}
                  onMouseLeave={clearPreview}
                  onBlur={clearPreview}
                  onClick={() => {
                    clearPreview();
                    onFiles([
                      new File([item.file], item.name, {
                        type: item.file.type,
                      }),
                    ]);
                    onUploadsClose();
                  }}
                >
                  {previews[item.id] ? (
                    <img src={previews[item.id]} alt="" />
                  ) : (
                    <span className={styles.file}>
                      {t("composerUploadFile")}
                    </span>
                  )}
                  <span className={styles.metadata}>
                    <time dateTime={new Date(item.at).toISOString()}>
                      {t("composerUploadAge", { age: uploadAge(item.at) })}
                    </time>
                    <span>
                      {item.origin?.projectName ??
                        t("composerUploadUnknownProject")}
                    </span>
                  </span>
                  <span>
                    {item.origin?.sessionTitle ??
                      item.origin?.sessionId ??
                      (item.origin?.projectId
                        ? t("composerAttachNewSession")
                        : t("composerUploadUnknownSession"))}
                  </span>
                  {!/^image(?:[-_]?\d+)?\.(?:png|jpe?g|webp)$/i.test(
                    item.name,
                  ) && <span>{item.name}</span>}
                </button>
              ))}
            </div>
          )}
          {expanded && !history.uploads.length && (
            <p>{t("composerUploadsEmpty")}</p>
          )}
          <div className={styles.actions}>
            {onMemo && (
              <button
                type="button"
                disabled={disabled}
                className={styles.memo}
                onClick={() => {
                  onUploadsClose();
                  onMemo();
                }}
              >
                <MicrophoneIcon size={24} />
                <span>
                  <strong>{t("audioMemoRecord")}</strong>
                  <small>{t("composerMemoDescription")}</small>
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onUploadsClose();
                onBrowse();
              }}
            >
              <span>
                <strong>{t("composerUploadsBrowse")}</strong>
                <small>{t("composerFilesDescription")}</small>
              </span>
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{t("composerUploadsError", { error })}</p>}
      {preview &&
        previews[preview.item.id] &&
        createPortal(
          <div className={styles.preview} role="tooltip" style={preview.box}>
            <img
              src={previews[preview.item.id]}
              alt={
                preview.item.origin?.sessionTitle ?? t("composerUploadsLabel")
              }
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

function uploadAge(at: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return minutes < 60
    ? `${minutes}m`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h`
      : `${Math.floor(minutes / 1440)}d`;
}
