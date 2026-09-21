import { toolDisplayContracts } from "./toolDisplayContracts";
import { defineTool } from "./defineTool";
import { useEffect, useState } from "react";
import type { ZodError } from "zod";
import { useSchemaValidationContext } from "../../../contexts/SchemaValidationContext";
import { validateToolResult } from "../../../lib/validateToolResult";
import { SchemaWarning } from "../../SchemaWarning";
import styles from "./KillShellRenderer.module.css";
import type { KillShellInput, KillShellResult } from "./types";

/**
 * KillShell tool use - shows shell_id being killed
 */
function KillShellToolUse({ input }: { input: KillShellInput }) {
  return (
    <div className={styles.toolUse}>
      <span className={styles.label}>Killing shell</span>
      <code className={styles.shellId}>{input.shell_id}</code>
    </div>
  );
}

/**
 * KillShell tool result - shows confirmation message
 */
function KillShellToolResult({ result }: { result: KillShellResult }) {
  const { enabled, reportValidationError, isToolIgnored } =
    useSchemaValidationContext();
  const [validationErrors, setValidationErrors] = useState<ZodError | null>(
    null,
  );

  useEffect(() => {
    if (enabled && result) {
      const validation = validateToolResult("KillShell", result);
      if (!validation.valid && validation.errors) {
        setValidationErrors(validation.errors);
        reportValidationError("KillShell", validation.errors);
      } else {
        setValidationErrors(null);
      }
    }
  }, [enabled, result, reportValidationError]);

  const showValidationWarning =
    enabled && validationErrors && !isToolIgnored("KillShell");

  if (!result) {
    return <div className={styles.empty}>No result</div>;
  }

  return (
    <div className={styles.result}>
      {showValidationWarning && validationErrors && (
        <SchemaWarning toolName="KillShell" errors={validationErrors} />
      )}
      <span className={styles.message}>{result.message}</span>
      {result.shell_id && (
        <code className={styles.shellId}>{result.shell_id}</code>
      )}
    </div>
  );
}

export const killShellRenderer = defineTool(toolDisplayContracts.KillShell, {
  tool: "KillShell",

  renderToolUse(input, _context) {
    return <KillShellToolUse input={input} />;
  },

  renderToolResult(result, _isError, _context) {
    return <KillShellToolResult result={result} />;
  },

  renderFailure(failure) {
    return (
      <div className={styles.error}>
        {failure.content || "Failed to kill shell"}
      </div>
    );
  },

  getFailureSummary() {
    return "Error";
  },

  getUseSummary(input) {
    return input.shell_id;
  },

  getResultSummary(result) {
    const r = result;
    return r?.message || "Killed";
  },
});
