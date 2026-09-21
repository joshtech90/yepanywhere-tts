import {
  MAX_PROJECT_CAPTION_LENGTH,
  normalizeProjectCaption,
} from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { Project } from "../types";
import styles from "./ProjectCaptionEditor.module.css";

interface ProjectCaptionEditorProps {
  project: Project;
  /** Saves an override; `null` clears it so the derived caption returns. */
  onUpdateCaption?: (project: Project, caption: string | null) => Promise<void>;
}

/**
 * Caption line on a project card. Read-only when no save handler is given;
 * otherwise clicking the caption (or the "Add a caption" placeholder) opens
 * an inline editor with save (✓) and cancel (×) controls.
 */
export function ProjectCaptionEditor({
  project,
  onUpdateCaption,
}: ProjectCaptionEditorProps) {
  const { t } = useI18n();
  const caption = project.caption;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(caption?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const startEdit = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDraft(caption?.text ?? "");
    setError(null);
    setEditing(true);
  };

  const cancelEdit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDraft(caption?.text ?? "");
    setError(null);
    setEditing(false);
  };

  const commitEdit = async () => {
    if (!onUpdateCaption || saving) return;
    let next: string;
    try {
      next = normalizeProjectCaption(draft);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("projectCaptionSaveFailed"),
      );
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    const unchanged =
      (next === "" && caption?.source !== "override") ||
      (next !== "" && next === caption?.text && caption?.source === "override");
    if (unchanged) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onUpdateCaption(project, next === "" ? null : next);
      setEditing(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("projectCaptionSaveFailed"),
      );
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setSaving(false);
    }
  };

  if (!caption && !onUpdateCaption) return null;

  const sourceHint =
    caption?.source === "override"
      ? t("projectCaptionSourceOverride")
      : caption?.source === "manifest"
        ? t("projectCaptionSourceManifest")
        : t("projectCaptionSourceReadme");

  if (editing && onUpdateCaption) {
    return (
      <div className={styles.slot}>
        <div className={styles.editor}>
          <input
            ref={inputRef}
            aria-label={t("projectCaptionLabel")}
            aria-invalid={error ? true : undefined}
            className={styles.input}
            disabled={saving}
            maxLength={MAX_PROJECT_CAPTION_LENGTH}
            placeholder={t("projectCaptionPlaceholder")}
            value={draft}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onBlur={() => void commitEdit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                cancelEdit(event);
              }
            }}
          />
          <button
            type="button"
            className={styles.save}
            aria-label={t("projectCaptionSave")}
            title={t("projectCaptionSave")}
            disabled={saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void commitEdit();
            }}
          >
            ✓
          </button>
          <button
            type="button"
            className={styles.cancel}
            aria-label={t("projectCaptionCancelEdit")}
            title={t("projectCaptionCancelEdit")}
            disabled={saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={cancelEdit}
          >
            ×
          </button>
        </div>
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (onUpdateCaption) {
    return (
      <div className={styles.slot}>
        <button
          type="button"
          className={caption ? styles.caption : styles.placeholder}
          aria-label={t("projectCaptionEdit")}
          title={caption ? sourceHint : t("projectCaptionEdit")}
          onClick={startEdit}
        >
          {caption ? caption.text : t("projectCaptionAdd")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.slot}>
      <span className={styles.caption} title={sourceHint}>
        {caption?.text}
      </span>
    </div>
  );
}
