import { useEffect, useRef } from "react";
import type { useProjectFileCompletion } from "../hooks/useProjectFileCompletion";
import { useI18n } from "../i18n";
import styles from "./ProjectFileCompletionMenu.module.css";

export function ProjectFileCompletionMenu({
  completion,
}: {
  completion: ReturnType<typeof useProjectFileCompletion>;
}) {
  const { t } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!completion.selected) return;
    menu.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [completion.selected]);
  if (!completion.visible) return null;
  return (
    <div
      ref={menu}
      className={styles.menu}
      role="listbox"
      aria-label={t("fileCompletionLabel")}
    >
      {completion.entries.map((entry) => {
        const path = entry.path.replace(/\/$/, "");
        const slash = path.lastIndexOf("/");
        return (
          <button
            key={entry.path}
            type="button"
            role="option"
            aria-selected={entry.path === completion.selected}
            className={styles.row}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => completion.accept(entry)}
          >
            <span className={styles.basename}>{path.slice(slash + 1)}</span>
            <span className={styles.parent}>
              {slash >= 0 ? path.slice(0, slash + 1) : ""}
            </span>
            <span className={styles.kind}>
              {entry.kind === "directory" ? "dir" : "file"}
            </span>
          </button>
        );
      })}
      {(completion.pending ||
        completion.error ||
        completion.entries.length === 0 ||
        completion.truncated) && (
        <div className={styles.status} role="status">
          {completion.error
            ? t("fileCompletionUnavailable")
            : completion.pending
              ? t("fileCompletionSearching")
              : completion.truncated
                ? t("fileCompletionMore")
                : t("fileCompletionEmpty")}
        </div>
      )}
    </div>
  );
}
