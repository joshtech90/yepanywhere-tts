export type CodeModeOutputPart =
  | { kind: "text" | "script-status"; text: string }
  | {
      kind: "command-output";
      text: string;
      exitCode?: number;
      durationSeconds: number;
      sessionId?: string | number;
    };

export interface DecodedCodeModeOutput {
  parts: CodeModeOutputPart[];
}

export interface DecodeCodeModeOutputOptions {
  /** Use preserve when the caller knows the script printed stdout directly. */
  commandResults?: "unwrap" | "preserve";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const COMMAND_KEYS = new Set([
  "chunk_id",
  "wall_time_seconds",
  "exit_code",
  "output",
  "session_id",
  "original_token_count",
]);
const SETTLED_KEYS = new Set(["i", "status", "value"]);

function decodeCommandResult(text: string): CodeModeOutputPart | undefined {
  let value = parseJson(text);
  if (!isRecord(value)) return undefined;
  if (value.status === "fulfilled") {
    if (
      !Object.keys(value).every((key) => SETTLED_KEYS.has(key)) ||
      (value.i !== undefined &&
        (!Number.isInteger(value.i) || Number(value.i) < 0))
    ) {
      return undefined;
    }
    value = value.value;
  }
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) => COMMAND_KEYS.has(key)) ||
    typeof value.chunk_id !== "string" ||
    !value.chunk_id ||
    typeof value.output !== "string" ||
    typeof value.wall_time_seconds !== "number" ||
    !Number.isFinite(value.wall_time_seconds) ||
    value.wall_time_seconds < 0
  ) {
    return undefined;
  }
  if (
    value.exit_code !== undefined &&
    (typeof value.exit_code !== "number" || !Number.isInteger(value.exit_code))
  ) {
    return undefined;
  }
  if (
    value.session_id !== undefined &&
    !(typeof value.session_id === "string" && value.session_id.length > 0) &&
    !(
      typeof value.session_id === "number" &&
      Number.isInteger(value.session_id) &&
      value.session_id >= 0
    )
  ) {
    return undefined;
  }
  if (value.exit_code === undefined && value.session_id === undefined)
    return undefined;
  if (
    value.original_token_count !== undefined &&
    !(
      typeof value.original_token_count === "number" &&
      Number.isInteger(value.original_token_count) &&
      value.original_token_count >= 0
    )
  ) {
    return undefined;
  }
  return {
    kind: "command-output",
    // stdout is a leaf: JSON printed by the command is never decoded again.
    text: value.output,
    durationSeconds: value.wall_time_seconds,
    ...(typeof value.exit_code === "number"
      ? { exitCode: value.exit_code }
      : {}),
    ...(typeof value.session_id === "string" ||
    typeof value.session_id === "number"
      ? { sessionId: value.session_id }
      : {}),
  };
}

/**
 * Decode known code-mode output only. Preserve block boundaries and retain the
 * original result at the call site for raw detail. Undefined means unrecognized
 * or mixed-media output, not empty output. This is format recognition, not proof
 * of origin: a script can print bytes identical to an execution result.
 */
export function decodeCodeModeOutput(
  result: unknown,
  options: DecodeCodeModeOutputOptions = {},
): DecodedCodeModeOutput | undefined {
  const value = typeof result === "string" ? parseJson(result) : result;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const parts: CodeModeOutputPart[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.type !== "string" ||
      !["input_text", "output_text", "text"].includes(item.type) ||
      typeof item.text !== "string"
    ) {
      return undefined;
    }
    const text = item.text;
    if (
      parts.length === 0 &&
      /^Script (?:completed|running with cell ID \w+)\r?\nWall time[^\n]*\r?\nOutput:\r?\n$/.test(
        text,
      )
    ) {
      parts.push({
        kind: "script-status",
        text: text.replace(/\r?\nOutput:\r?\n$/, ""),
      });
    } else {
      parts.push(
        (options.commandResults !== "preserve"
          ? decodeCommandResult(text)
          : undefined) ?? { kind: "text", text },
      );
    }
  }
  return { parts };
}
