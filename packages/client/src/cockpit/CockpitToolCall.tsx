import { useState } from "react";
import { useI18n, type TranslationFn } from "../i18n";
import type { CockpitToolEntry } from "./core/sessionDetail";
import type {
  CockpitDiffLine,
  CockpitToolStatus,
} from "./core/toolDisplay";
import { CockpitToolCopyButton } from "./CockpitToolCopyButton";
import styles from "./CockpitToolCall.module.css";

export interface CockpitToolCallProps {
  entry: CockpitToolEntry;
  /** False once the session stopped working; unset keeps the item status. */
  sessionWorking?: boolean;
  time: string | null;
}

function ToolIcon({ kind }: { kind: CockpitToolEntry["tool"]["kind"] }) {
  if (kind === "shell") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 7 4 5-4 5M11 17h8" />
      </svg>
    );
  }
  if (kind === "files") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h7l4 4v14H7zM14 3v5h4" />
        <path d="m10 14 2 2 4-5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4h6l1 3 3 1v6l-3 1-1 3H9l-1-3-3-1V8l3-1z" />
      <circle cx="12" cy="11" r="2.5" />
    </svg>
  );
}

function statusLabel(status: CockpitToolStatus, t: TranslationFn) {
  switch (status) {
    case "pending":
      return t("cockpitToolStatusRunning");
    case "complete":
      return t("cockpitToolStatusComplete");
    case "error":
      return t("cockpitToolStatusError");
    case "aborted":
      return t("cockpitToolStatusAborted");
    case "incomplete":
      return t("cockpitToolStatusIncomplete");
  }
}

function DiffLine({ line }: { line: CockpitDiffLine }) {
  if (line.kind === "hunk") {
    return (
      <div className={styles.diffHunk}>
        <span />
        <span />
        <code>{line.text}</code>
      </div>
    );
  }
  const marker =
    line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : " ";
  return (
    <div className={styles.diffLine} data-kind={line.kind}>
      <span>{line.oldLine ?? ""}</span>
      <span>{line.newLine ?? ""}</span>
      <code>
        <b aria-hidden="true">{marker}</b>
        {line.text}
      </code>
    </div>
  );
}

function diffClipboardText(lines: readonly CockpitDiffLine[]): string {
  return lines
    .map((line) => {
      if (line.kind === "hunk") return line.text;
      const marker =
        line.kind === "addition"
          ? "+"
          : line.kind === "deletion"
            ? "-"
            : " ";
      return `${marker}${line.text}`;
    })
    .join("\n");
}

function CopyableCodeSection({
  copiedLabel,
  copyLabel,
  error = false,
  heading,
  text,
}: {
  copiedLabel: string;
  copyLabel: string;
  error?: boolean;
  heading: string;
  text: string;
}) {
  const { t } = useI18n();
  return (
    <section className={styles.codeSection} data-error={error || undefined}>
      <div className={styles.codeHeading}>
        <h4>{heading}</h4>
        <CockpitToolCopyButton
          copiedLabel={copiedLabel}
          failedLabel={t("cockpitToolCopyFailed")}
          label={copyLabel}
          text={text}
        />
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </section>
  );
}

function ShellDetail({ entry }: { entry: CockpitToolEntry }) {
  const { t } = useI18n();
  const shell = entry.tool.shell;
  if (!shell) return null;
  const hasOutput = Boolean(shell.stdout || shell.stderr);
  return (
    <div className={styles.detailStack}>
      <div className={styles.metadata}>
        {shell.exitCode !== null && (
          <span>{t("cockpitToolExitCode", { code: shell.exitCode })}</span>
        )}
        {shell.interrupted && <span>{t("cockpitToolInterrupted")}</span>}
      </div>
      {shell.command && (
        <CopyableCodeSection
          copiedLabel={t("cockpitToolCommandCopied")}
          copyLabel={t("cockpitToolCopyCommand")}
          heading={t("cockpitToolCommand")}
          text={shell.command}
        />
      )}
      {shell.stdout && (
        <CopyableCodeSection
          copiedLabel={t("cockpitToolOutputCopied")}
          copyLabel={t("cockpitToolCopyOutput")}
          heading={t("cockpitToolOutput")}
          text={shell.stdout}
        />
      )}
      {shell.stderr && (
        <CopyableCodeSection
          copiedLabel={t("cockpitToolErrorOutputCopied")}
          copyLabel={t("cockpitToolCopyErrorOutput")}
          error
          heading={t("cockpitToolErrorOutput")}
          text={shell.stderr}
        />
      )}
      {!hasOutput && entry.tool.status !== "pending" && (
        <p className={styles.noData}>{t("cockpitToolNoOutput")}</p>
      )}
    </div>
  );
}

function FilesDetail({ entry }: { entry: CockpitToolEntry }) {
  const { t } = useI18n();
  const [selectedPath, setSelectedPath] = useState(
    entry.tool.files[0]?.path ?? "",
  );
  const selected =
    entry.tool.files.find((file) => file.path === selectedPath) ??
    entry.tool.files[0];
  if (!selected) return null;

  return (
    <div className={styles.fileDetail}>
      {entry.tool.files.length > 1 && (
        <div
          aria-label={t("cockpitToolFilesAria")}
          className={styles.fileTabs}
          role="group"
        >
          {entry.tool.files.map((file) => {
            const active = file.path === selected.path;
            return (
              <button
                aria-pressed={active}
                className={active ? styles.activeFile : undefined}
                key={file.path}
                onClick={() => setSelectedPath(file.path)}
                type="button"
              >
                {file.path}
              </button>
            );
          })}
        </div>
      )}
      <div className={styles.fileHeader}>
        <strong title={selected.path}>{selected.path}</strong>
        <div className={styles.fileHeaderActions}>
          <span>
            <span className={styles.visuallyHidden}>
              {t("cockpitToolDiffStats", {
                additions: selected.additions,
                deletions: selected.deletions,
              })}
            </span>
            <b aria-hidden="true">+{selected.additions}</b>
            <i aria-hidden="true">−{selected.deletions}</i>
          </span>
          {selected.lines.length > 0 && (
            <CockpitToolCopyButton
              copiedLabel={t("cockpitToolDiffCopied")}
              failedLabel={t("cockpitToolCopyFailed")}
              key={selected.path}
              label={t("cockpitToolCopyDiff")}
              text={diffClipboardText(selected.lines)}
            />
          )}
        </div>
      </div>
      {selected.lines.length > 0 ? (
        <div
          aria-label={t("cockpitToolDiffAria", { path: selected.path })}
          className={styles.diff}
          role="region"
        >
          {selected.lines.map((line) => (
            <DiffLine
              key={`${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${line.text}`}
              line={line}
            />
          ))}
          {selected.truncated && (
            <p className={styles.truncated}>{t("cockpitToolDiffTruncated")}</p>
          )}
        </div>
      ) : (
        <p className={styles.noData}>{t("cockpitToolNoDiff")}</p>
      )}
    </div>
  );
}

function GenericDetail({ entry }: { entry: CockpitToolEntry }) {
  const { t } = useI18n();
  return (
    <div className={styles.detailStack}>
      {!entry.tool.recognized && (
        <p className={styles.unknownNotice} role="note">
          {t("cockpitToolUnknown")}
        </p>
      )}
      {entry.tool.rawInput && (
        <CopyableCodeSection
          copiedLabel={t("cockpitToolInputCopied")}
          copyLabel={t("cockpitToolCopyInput")}
          heading={t("cockpitToolInput")}
          text={entry.tool.rawInput}
        />
      )}
      {entry.tool.rawResult && (
        <CopyableCodeSection
          copiedLabel={t("cockpitToolResultCopied")}
          copyLabel={t("cockpitToolCopyResult")}
          heading={t("cockpitToolResult")}
          text={entry.tool.rawResult}
        />
      )}
      {!entry.tool.rawInput && !entry.tool.rawResult && (
        <p className={styles.noData}>{t("cockpitToolNoDetails")}</p>
      )}
    </div>
  );
}

export function CockpitToolCall({
  entry,
  sessionWorking,
  time,
}: CockpitToolCallProps) {
  const { t } = useI18n();
  // A call without a result only runs while its session is working; once the
  // session is idle the same call has ended without one.
  const status =
    entry.tool.status === "pending" && sessionWorking === false
      ? "incomplete"
      : entry.tool.status;
  return (
    <details
      className={styles.card}
      data-cockpit-entry-key={entry.key}
      data-status={status}
      data-tool-kind={entry.tool.kind}
    >
      <summary
        aria-label={t("cockpitToolToggle", {
          tool: entry.tool.displayName,
        })}
      >
        <span className={styles.icon}>
          <ToolIcon kind={entry.tool.kind} />
        </span>
        <span className={styles.title}>
          <strong>{entry.tool.displayName}</strong>
          <small>{entry.tool.summary}</small>
        </span>
        <span
          className={styles.status}
          data-status={status}
        >
          <i aria-hidden="true" />
          {statusLabel(status, t)}
        </span>
        {time && <time dateTime={entry.timestamp}>{time}</time>}
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.body}>
        {entry.tool.kind === "shell" ? (
          <ShellDetail entry={entry} />
        ) : entry.tool.kind === "files" ? (
          <FilesDetail entry={entry} />
        ) : (
          <GenericDetail entry={entry} />
        )}
      </div>
    </details>
  );
}
