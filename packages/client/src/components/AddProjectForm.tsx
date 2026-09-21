import {
  MAX_PROJECT_CODE_NAME_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  allocateProjectCodeName,
  defaultProjectNameForPath,
  normalizeProjectCodeName,
} from "@yep-anywhere/shared";
import { type FormEvent, useId, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { Project } from "../types";
import styles from "./AddProjectForm.module.css";

export interface AddProjectRequest {
  path: string;
  /** Present only when the user chose a name other than the path's own. */
  name?: string;
  /** Present only when the user edited the code; else the server allocates. */
  codeName?: string;
}

interface AddProjectFormProps {
  /** Existing projects, for the default code allocation. */
  projects: readonly Project[];
  /** The server accepts a chosen name and code (`project-names`). */
  chooseName: boolean;
  /** Code names are supported and shown in this browser. */
  chooseCodeName: boolean;
  adding: boolean;
  error: string | null;
  onSubmit: (request: AddProjectRequest) => void;
  onCancel: () => void;
}

/**
 * Path entry for a new project, with the name and code the project will get.
 * Both follow the path until the user types into them; clearing a field
 * hands it back to the default, so the defaults stay visible and editable
 * rather than hidden behind an empty placeholder.
 */
export function AddProjectForm({
  projects,
  chooseName,
  chooseCodeName,
  adding,
  error,
  onSubmit,
  onCancel,
}: AddProjectFormProps) {
  const { t } = useI18n();
  const id = useId();
  const [path, setPath] = useState("");
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const defaultName = defaultProjectNameForPath(path);
  const name = nameDraft ?? defaultName;
  const defaultCode = useMemo(() => {
    if (!chooseCodeName || !name.trim()) return "";
    return allocateProjectCodeName(
      name,
      projects.flatMap((project) =>
        project.codeName ? [project.codeName] : [],
      ),
      projects.map((project) => project.name),
    );
  }, [chooseCodeName, name, projects]);
  const code = codeDraft ?? defaultCode;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedPath = path.trim();
    if (!trimmedPath) return;
    const request: AddProjectRequest = { path: trimmedPath };
    if (chooseName) {
      const chosenName = name.trim();
      if (chosenName && chosenName !== defaultName) request.name = chosenName;
    }
    if (chooseCodeName && codeDraft?.trim()) {
      try {
        request.codeName = normalizeProjectCodeName(codeDraft);
      } catch (caught) {
        setCodeError(
          caught instanceof Error
            ? caught.message
            : t("projectCodeNameInvalid"),
        );
        return;
      }
    }
    onSubmit(request);
  };

  return (
    <form onSubmit={submit} className={styles.form}>
      <input
        type="text"
        className={styles.input}
        aria-label={t("projectsAddPathLabel")}
        value={path}
        onChange={(event) => setPath(event.target.value)}
        placeholder={t("projectsAddPlaceholder")}
        disabled={adding}
      />
      {chooseName && (
        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-name`}>
              {t("projectsAddNameLabel")}
            </label>
            <input
              id={`${id}-name`}
              type="text"
              className={`${styles.input} ${styles.text}`}
              aria-describedby={`${id}-name-hint`}
              maxLength={MAX_PROJECT_NAME_LENGTH}
              value={name}
              onChange={(event) =>
                setNameDraft(
                  event.target.value === "" ? null : event.target.value,
                )
              }
              disabled={adding}
            />
            <span id={`${id}-name-hint`} className={styles.hint}>
              {t("projectsAddNameHint")}
            </span>
          </div>
          {chooseCodeName && (
            <div className={`${styles.field} ${styles.codeField}`}>
              <label className={styles.label} htmlFor={`${id}-code`}>
                {t("projectsAddCodeNameLabel")}
              </label>
              <input
                id={`${id}-code`}
                type="text"
                className={styles.input}
                aria-describedby={`${id}-code-hint`}
                aria-invalid={codeError ? true : undefined}
                maxLength={MAX_PROJECT_CODE_NAME_LENGTH}
                value={code}
                onChange={(event) => {
                  setCodeError(null);
                  setCodeDraft(
                    event.target.value === "" ? null : event.target.value,
                  );
                }}
                disabled={adding}
              />
              <span id={`${id}-code-hint`} className={styles.hint}>
                {codeError ?? t("projectsAddCodeNameHint")}
              </span>
            </div>
          )}
        </div>
      )}
      <div className={styles.actions}>
        <button type="submit" disabled={adding || !path.trim()}>
          {adding ? t("projectsAdding") : t("projectsAddConfirm")}
        </button>
        <button type="button" onClick={onCancel} disabled={adding}>
          {t("projectsCancel")}
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </form>
  );
}
