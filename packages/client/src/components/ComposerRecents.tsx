import { useEffect, useState } from "react";
import {
  readComposerHistory,
  type ComposerHistory,
} from "../lib/composerHistory";
import styles from "./ComposerRecents.module.css";
import { useI18n } from "../i18n";

export function ComposerRecents({
  scope,
  onFiles,
  uploadsOpen,
  onUploadsClose,
  onBrowse,
}: {
  scope: string | null;
  onFiles: (files: File[]) => void;
  uploadsOpen: boolean;
  onUploadsClose: () => void;
  onBrowse: () => void;
}) {
  const { t } = useI18n();
  const [history, setHistory] = useState<ComposerHistory>({
    prompts: [],
    uploads: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    setHistory({ prompts: [], uploads: [] });
    setError(null);
    if (scope && uploadsOpen) {
      void readComposerHistory(scope)
        .then((value) => {
          if (active) setHistory(value);
        })
        .catch((cause: unknown) => {
          if (active) setError(String(cause));
        });
    }
    return () => {
      active = false;
    };
  }, [scope, uploadsOpen]);
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
          aria-label={t("composerUploadsLabel")}
        >
          <div className={styles.heading}>
            <strong>{t("composerUploadsLabel")}</strong>
            <button
              type="button"
              aria-label={t("composerUploadsClose")}
              onClick={onUploadsClose}
            >
              ×
            </button>
          </div>
          <small>{t("composerHistoryLocal")}</small>
          <button type="button" onClick={onBrowse}>
            {t("composerUploadsBrowse")}
          </button>
          <div className={styles.tiles}>
            {history.uploads.map((item) => (
              <button
                type="button"
                key={item.id}
                title={item.name}
                onClick={() => {
                  onFiles([
                    new File([item.file], item.name, { type: item.file.type }),
                  ]);
                  onUploadsClose();
                }}
              >
                {previews[item.id] ? (
                  <img src={previews[item.id]} alt="" />
                ) : (
                  <span className={styles.file}>{t("composerUploadFile")}</span>
                )}
                <span>{item.name}</span>
              </button>
            ))}
          </div>
          {!history.uploads.length && <p>{t("composerUploadsEmpty")}</p>}
        </div>
      )}
      {error && <p role="alert">{t("composerUploadsError", { error })}</p>}
    </div>
  );
}
