import { toolDisplayContracts } from "./toolDisplayContracts";
import { defineTool } from "./defineTool";
import styles from "./SkillRenderer.module.css";
import type { SkillInput, SkillResult } from "./types";

/** Arguments are free prose the agent typed; keep one readable line of it. */
function compactArgs(args: string | undefined): string | undefined {
  const text = args?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function skillName(
  result: SkillResult | undefined,
  input: SkillInput | undefined,
): string {
  return result?.commandName ?? input?.skill ?? "skill";
}

function SkillToolUse({ input }: { input: SkillInput }) {
  const args = compactArgs(input.args);
  return (
    <div className={styles.toolUse}>
      <code className={styles.name}>{input.skill}</code>
      {args ? <span className={styles.args}>{args}</span> : null}
    </div>
  );
}

function SkillToolResult({
  result,
  input,
}: {
  result: SkillResult;
  input?: SkillInput;
}) {
  const name = skillName(result, input);
  if (!result.success) {
    return <div className={styles.error}>{name} did not load</div>;
  }
  // A completed row shows only this result, so the arguments the skill was
  // invoked with belong here too; they are the part of the call that varies.
  const args = compactArgs(input?.args);
  return (
    <div className={styles.result}>
      <span className={styles.label}>Loaded</span>
      <code className={styles.name}>{name}</code>
      {args ? <span className={styles.args}>{args}</span> : null}
    </div>
  );
}

export const skillRenderer = defineTool(toolDisplayContracts.Skill, {
  tool: "Skill",
  displayName: "Skill",
  pendingDisplayName: "Loading skill",

  renderToolUse(input, _context) {
    return <SkillToolUse input={input} />;
  },

  renderToolResult(result, _isError, _context, input) {
    return <SkillToolResult result={result} input={input} />;
  },

  renderFailure(failure) {
    return (
      <div className={styles.error}>{failure.content || "Skill failed"}</div>
    );
  },

  getFailureSummary() {
    return "Error";
  },

  getUseSummary(input) {
    const args = compactArgs(input.args);
    return args ? `${input.skill} ${args}` : input.skill;
  },

  getResultSummary(result, isError, input) {
    if (isError) return "Error";
    return result.success ? skillName(result, input) : "Not loaded";
  },
});
