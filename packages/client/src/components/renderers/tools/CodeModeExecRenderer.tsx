import type { ToolRenderer } from "./types";
import { decodeCodeModeOutput } from "@yep-anywhere/shared";
import { useI18n } from "../../../i18n";
import styles from "./CodeModeExecRenderer.module.css";
import { formatCommandDuration } from "../../../lib/shellToolOutput";

interface CodeModeCall {
  input: unknown;
  toolName: string;
}

interface CodeModeExecInput {
  calls: CodeModeCall[];
  source: string;
}

function isCodeModeExecInput(input: unknown): input is CodeModeExecInput {
  return (
    !!input &&
    typeof input === "object" &&
    Array.isArray((input as CodeModeExecInput).calls)
  );
}

function getCallPreview(call: CodeModeCall): string {
  if (
    call.toolName === "exec_command" &&
    call.input &&
    typeof call.input === "object"
  ) {
    const command = (call.input as Record<string, unknown>).cmd;
    if (typeof command === "string" && command.trim()) {
      return command.trim();
    }
  }
  return call.toolName;
}

function getCallCountSummary(input: unknown): string {
  if (!isCodeModeExecInput(input) || input.calls.length === 0) {
    return "done";
  }
  const noun = input.calls.every((call) => call.toolName === "exec_command")
    ? "command"
    : "tool call";
  const skills = [
    ...new Set(
      input.calls.flatMap((call) => {
        const skill = getSkillRead(call);
        return skill ? [`${skill.name}/SKILL.md`] : [];
      }),
    ),
  ];
  const count = `${input.calls.length} ${noun}${input.calls.length === 1 ? "" : "s"}`;
  return skills.length ? `${skills.join(", ")} · ${count}` : count;
}

// Only recognize a literal leading cat operand, never a path mentioned in code
// or a search query. A trailing command keeps the parent an ordinary Exec.
function getSkillRead(call: CodeModeCall) {
  if (call.toolName !== "exec_command") return undefined;
  const match =
    /^cat\s+(?:'([^']+)'|"([^"$`]+)"|([^\s;|&<>"'$`]+))(?=\s|;|$)([\s\S]*)$/.exec(
      getCallPreview(call),
    );
  if (!match) return undefined;
  const path = match[1] ?? match[2] ?? match[3] ?? "";
  const segments = path.split(/[\\/]/);
  const name = segments.at(-2);
  if (!name || segments.at(-1) !== "SKILL.md") return undefined;
  return { name, onlyRead: /^\s*;?\s*$/.test(match[4] ?? "") };
}

function readSkillDocument(text: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!frontmatter) return undefined;
  const name = /^name:\s*([\w.-]+)\s*$/m.exec(frontmatter[1] ?? "")?.[1];
  if (!name) return undefined;
  const description = /^description:[ \t]*(.+)$/m.exec(
    frontmatter[1] ?? "",
  )?.[1];
  return { name, description };
}

function ExecOutput({
  result,
  isError,
  input,
}: {
  result: unknown;
  isError: boolean;
  input?: unknown;
}) {
  const { t } = useI18n();
  const raw =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const decoded = decodeCodeModeOutput(result);
  const readsSkill =
    isCodeModeExecInput(input) &&
    input.calls.some((call) => getSkillRead(call));
  if (!decoded) {
    return (
      <pre className={`${styles.text} ${isError ? styles.error : ""}`}>
        {raw}
      </pre>
    );
  }
  return (
    <div className={`${styles.output} ${isError ? styles.error : ""}`}>
      {decoded.parts.map((part, index) => {
        const command = part.kind === "command-output" ? part : undefined;
        const { text } = part;
        const skill = readsSkill ? readSkillDocument(text) : undefined;
        const documentTitle = skill
          ? t("codeModeExecSkill", { name: skill.name })
          : /^# ([^\r\n]+)\r?\n/.exec(text)?.[1];
        if (part.kind === "script-status") {
          return (
            <p className={styles.metadata} key={index}>
              {text}
            </p>
          );
        }
        const metadata = [
          command?.exitCode !== undefined
            ? t("codeModeExecExitCode", { code: command.exitCode })
            : "",
          command?.durationSeconds !== undefined
            ? formatCommandDuration(command.durationSeconds)
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div
            key={index}
            className={command?.exitCode ? styles.error : undefined}
          >
            {metadata && <p className={styles.metadata}>{metadata}</p>}
            {documentTitle ? (
              <details className={styles.document}>
                <summary className={styles.summary}>{documentTitle}</summary>
                {skill?.description && (
                  <p className={styles.description}>{skill.description}</p>
                )}
                <pre className={styles.text}>{text}</pre>
              </details>
            ) : (
              <pre className={styles.text}>{text}</pre>
            )}
          </div>
        );
      })}
      <details className={styles.document}>
        <summary className={styles.summary}>{t("codeModeExecRaw")}</summary>
        {isCodeModeExecInput(input) && (
          <pre className={styles.text}>{input.source}</pre>
        )}
        <pre className={styles.text}>{raw}</pre>
      </details>
    </div>
  );
}

export const codeModeExecRenderer: ToolRenderer = {
  tool: "Exec",
  displayName: "Exec",

  displayNameForCall(input, status) {
    if (
      isCodeModeExecInput(input) &&
      input.calls.length > 0 &&
      input.calls.every((call) => getSkillRead(call)?.onlyRead)
    ) {
      return status === "pending" ? "Loading skill" : "Skill load";
    }
    return undefined;
  },

  renderToolUse(input) {
    if (!isCodeModeExecInput(input)) return null;
    return (
      <pre className={styles.text}>
        <code>{input.calls.map(getCallPreview).join("\n")}</code>
      </pre>
    );
  },

  renderToolResult(result, isError, _context, input) {
    return <ExecOutput result={result} isError={isError} input={input} />;
  },

  getUseSummary(input) {
    return getCallCountSummary(input);
  },

  getResultSummary(_result, isError, input) {
    return isError ? "failed" : getCallCountSummary(input);
  },
};
