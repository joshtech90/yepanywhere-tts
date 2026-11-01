import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import styles from "./SettingsDocLink.module.css";

const SETTINGS_DOC_BLOB_BASE =
  "https://github.com/kzahel/yepanywhere/blob/main/";

/**
 * Documentation for a setting whose effect is not self-evident: a
 * repository-relative Markdown path, optionally with a `#fragment`. The link
 * text names the document after its file unless a label is given.
 */
export type SettingsDoc = string | { path: string; label: string };

function docPath(doc: SettingsDoc): string {
  return typeof doc === "string" ? doc : doc.path;
}

/** Published upstream copy, so installed and hosted clients reach the same page. */
export function settingsDocHref(doc: SettingsDoc): string {
  return `${SETTINGS_DOC_BLOB_BASE}${docPath(doc)}`;
}

/** `topics/prompt-cache-keepalive.md#budget` → `prompt cache keepalive`. */
export function settingsDocLabel(doc: SettingsDoc): string {
  if (typeof doc !== "string") return doc.label;
  const file = doc.split("#")[0]?.split("/").pop() ?? doc;
  return file.replace(/\.md$/u, "").replaceAll("-", " ");
}

export function SettingsDocLink({ doc }: { doc: SettingsDoc }) {
  const { t } = useI18n();
  return (
    <a
      className={styles.link}
      href={settingsDocHref(doc)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {t("settingsDocLink", { doc: settingsDocLabel(doc) })}
    </a>
  );
}

/** A caption followed by its documentation link, on the caption's line. */
export function SettingsCaption({
  text,
  doc,
}: {
  text: ReactNode;
  doc?: SettingsDoc;
}) {
  if (!doc) return <>{text}</>;
  return (
    <>
      {text} <SettingsDocLink doc={doc} />
    </>
  );
}
