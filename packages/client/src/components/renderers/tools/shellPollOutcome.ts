import { decodeCodeModeOutput } from "@yep-anywhere/shared";
import {
  getCommandResultMeta,
  parseShellToolOutput,
} from "@yep-anywhere/shared/transcript/shellToolOutput";

/** Longest single output line a poll may show without an expansion control
 * (contract: topics/provider-output-contract.md § Compact shell poll results). */
const MAX_COMPACT_OUTPUT_CHARS = 500;

/** `agentctl`'s observation window expired while the target kept running. It
 * reports this on stderr with exit code 1; the wait itself is not a failure. */
const WAIT_TIMEOUT_RE =
  /^timeout waiting for ([^\r\n]+) to reach not-running; current status=running$/;

export type ShellPollOutcome =
  | { kind: "waiting"; target: string; output: string; exitCode?: number }
  | { kind: "compact"; output: string; exitCode?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Text a shell command or poll result displays: the decoded code-mode parts
 * when the result is an execution envelope, otherwise the result's own
 * command output. Combined stdout/stderr matters here because the wait
 * timeout below arrives on stderr.
 */
export function shellResultText(result: unknown): string {
  const decoded = decodeCodeModeOutput(result);
  if (decoded)
    return decoded.parts
      .filter((part) => part.kind !== "script-status")
      .map((part) => part.text)
      .join("\n");
  if (typeof result === "string") return result;

  if (isRecord(result)) {
    // Normalized command results carry the text under content/stdout+stderr;
    // unified-exec chunk records carry it under output.
    if (typeof result.content === "string") return result.content;
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    if (stdout || stderr) return [stdout, stderr].filter(Boolean).join("\n");
    if (typeof result.output === "string") return result.output;
  }

  if (result === null || result === undefined) return "";
  if (typeof result === "number" || typeof result === "boolean")
    return String(result);
  return JSON.stringify(result, null, 2);
}

/**
 * Classify a shell command or poll result that is short enough to display as
 * one line beside its row label, and recognize the one informational wait
 * outcome among those lines. Returns null when the result needs the ordinary
 * expandable presentation: several output blocks, multiline, empty, or long
 * output.
 *
 * Callers own their own applicability: which tools and call states can hold a
 * poll at all, and whether the call submitted input or read a file. This
 * function decides only what the *result* is
 * (contract: topics/provider-output-contract.md § Compact shell poll results).
 *
 * `envelopeText` is the raw result text to read an exit code from when the
 * structured result carries none, for providers that report the code only in
 * their output envelope.
 */
export function shellPollOutcome(
  result: unknown,
  isError: boolean,
  envelopeText?: string,
): ShellPollOutcome | null {
  const decoded = decodeCodeModeOutput(result);
  const parts = decoded?.parts.filter((part) => part.kind !== "script-status");
  if (parts && parts.length !== 1) return null;
  const part = parts?.[0];
  const parsed = parseShellToolOutput(part?.text ?? shellResultText(result), {
    bareExitCodeIsEnvelope: isError,
  });
  const output = parsed.output.trim();
  if (
    output.length === 0 ||
    output.length > MAX_COMPACT_OUTPUT_CHARS ||
    /[\r\n]/.test(output)
  )
    return null;

  const exitCode =
    getCommandResultMeta(result).exitCode ??
    (part?.kind === "command-output" ? part.exitCode : undefined) ??
    parsed.exitCode ??
    (envelopeText
      ? parseShellToolOutput(envelopeText, { bareExitCodeIsEnvelope: isError })
          .exitCode
      : undefined);

  const target = exitCode === 1 ? WAIT_TIMEOUT_RE.exec(output)?.[1] : undefined;
  return target
    ? { kind: "waiting", target, output, exitCode }
    : { kind: "compact", output, exitCode };
}
