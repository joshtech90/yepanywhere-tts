import type { ToolCallItem } from "@yep-anywhere/shared/transcript/items";
import { getDisplayBashCommandFromInput } from "../../lib/bashCommand";
import { normalizeBashResult } from "../../lib/bashResult";
import { canonicalizeToolName } from "../../lib/toolNames";

const MAX_RAW_CHARS = 12_000;
const MAX_DIFF_LINES = 600;

const KNOWN_TOOL_NAMES = new Set([
  "AskUserQuestion",
  "Bash",
  "BashOutput",
  "Edit",
  "Exec",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "KillShell",
  "Read",
  "Skill",
  "Task",
  "TaskCreate",
  "TaskOutput",
  "TaskUpdate",
  "TodoWrite",
  "UpdatePlan",
  "ViewImage",
  "Web",
  "WebFetch",
  "WebSearch",
  "Write",
  "WriteStdin",
  "create_goal",
  "get_goal",
  "spawn_agent",
  "update_goal",
]);

const SHELL_TOOL_NAMES = new Set([
  "Bash",
  "BashOutput",
  "Exec",
  "KillShell",
  "WriteStdin",
]);

export type CockpitToolStatus = ToolCallItem["status"];
export type CockpitToolKind = "shell" | "files" | "generic";
export type CockpitDiffLineKind = "context" | "addition" | "deletion" | "hunk";

export interface CockpitDiffLine {
  kind: CockpitDiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface CockpitFileChange {
  path: string;
  additions: number;
  deletions: number;
  lines: CockpitDiffLine[];
  truncated: boolean;
}

export interface CockpitShellDisplay {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  interrupted: boolean;
}

export interface CockpitToolDisplay {
  displayName: string;
  files: CockpitFileChange[];
  kind: CockpitToolKind;
  rawInput: string;
  rawResult: string;
  recognized: boolean;
  shell: CockpitShellDisplay | null;
  status: CockpitToolStatus;
  summary: string;
}

interface MutableFileChange {
  path: string;
  sourceLines: Array<{
    text: string;
    oldStart?: number;
    newStart?: number;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedText(text: string): string {
  if (text.length <= MAX_RAW_CHARS) return text;
  return `${text.slice(0, MAX_RAW_CHARS)}\n…`;
}

function serialize(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return boundedText(value);
  try {
    return boundedText(JSON.stringify(value, null, 2));
  } catch {
    return String(value);
  }
}

function firstLine(text: string, maxLength = 100): string {
  const line = text
    .split(/\r?\n/, 1)[0]
    ?.replace(/\s+/g, " ")
    .trim();
  if (!line) return "";
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

function getFirstStringValue(input: unknown): string {
  if (!isRecord(input)) return "";
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim()) {
      return firstLine(value);
    }
  }
  return "";
}

function resultValue(item: ToolCallItem): unknown {
  return item.toolResult?.structured ?? item.toolResult?.content;
}

function shellCommand(input: unknown): string {
  const displayed = getDisplayBashCommandFromInput(input);
  if (displayed) return displayed;
  if (!isRecord(input)) return "";
  const command = input.command ?? input.cmd;
  if (!Array.isArray(command)) return "";
  const parts = command.filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  if (
    parts.length >= 3 &&
    /(?:^|[/\\])(?:ba|z|da)?sh$/i.test(parts[0] ?? "") &&
    parts[1] === "-lc"
  ) {
    return parts.slice(2).join(" ");
  }
  return parts.join(" ");
}

function getExitCode(value: unknown, content: string): number | null {
  if (isRecord(value)) {
    const exitCode =
      numberValue(value.exitCode) ?? numberValue(value.exit_code);
    if (exitCode !== undefined) return exitCode;
  }
  const match = /^Exit code:\s*(-?\d+)\b/m.exec(content);
  return match ? Number(match[1]) : null;
}

function getShellDisplay(
  item: ToolCallItem,
  canonicalName: string,
): CockpitShellDisplay {
  const result = resultValue(item);
  const resultRecord = isRecord(result) ? result : undefined;
  const content = item.toolResult?.content ?? "";
  const command =
    shellCommand(item.toolInput) ||
    nonEmptyString(
      isRecord(item.toolInput)
        ? item.toolInput.linked_command ??
            item.toolInput.command ??
            item.toolInput.cmd
        : undefined,
    ) ||
    (canonicalName === "KillShell" ? getFirstStringValue(item.toolInput) : "");

  if (canonicalName === "Bash") {
    const isError =
      item.toolResult?.isError === true || item.status === "error";
    const normalized = normalizeBashResult(
      result,
      isError,
    );
    return {
      command,
      stdout: normalized.stdout || (!isError ? content : ""),
      stderr: normalized.stderr || (isError ? content : ""),
      exitCode: normalized.exitCode ?? getExitCode(result, content),
      interrupted: normalized.interrupted || item.status === "aborted",
    };
  }

  const stdout =
    nonEmptyString(resultRecord?.stdout) ??
    nonEmptyString(resultRecord?.output) ??
    (item.toolResult?.isError ? "" : content);
  const stderr =
    nonEmptyString(resultRecord?.stderr) ??
    (item.toolResult?.isError ? content : "");
  return {
    command,
    stdout,
    stderr,
    exitCode: getExitCode(result, content),
    interrupted:
      resultRecord?.interrupted === true || item.status === "aborted",
  };
}

function filePathFromHeader(line: string): string | undefined {
  const applyPatch = /^\*\*\*\s+(?:Update File|Add File|Delete File|Move to):\s+(.+?)\s*$/.exec(
    line,
  );
  if (applyPatch?.[1]) return applyPatch[1].trim();
  const gitHeader = /^diff --git a\/(.+?) b\/(.+?)\s*$/.exec(line);
  if (gitHeader?.[2]) return gitHeader[2].trim();
  const newFile = /^\+\+\+\s+(?:b\/)?(.+?)\s*$/.exec(line);
  if (newFile?.[1] && newFile[1] !== "/dev/null") return newFile[1].trim();
  return undefined;
}

function mutableFile(
  files: Map<string, MutableFileChange>,
  path: string,
): MutableFileChange {
  const normalized = path.trim() || "Edit";
  const existing = files.get(normalized);
  if (existing) return existing;
  const created = { path: normalized, sourceLines: [] };
  files.set(normalized, created);
  return created;
}

function addRawPatch(
  files: Map<string, MutableFileChange>,
  patch: string,
  fallbackPath?: string,
  preservePopulatedFiles = false,
) {
  const selectFile = (path: string): MutableFileChange | null => {
    const file = mutableFile(files, path);
    return preservePopulatedFiles && file.sourceLines.length > 0
      ? null
      : file;
  };
  let current: MutableFileChange | null | undefined = fallbackPath
    ? selectFile(fallbackPath)
    : undefined;
  for (const line of patch.replace(/\r\n?/g, "\n").split("\n")) {
    const headerPath = filePathFromHeader(line);
    if (headerPath) {
      current = selectFile(headerPath);
      continue;
    }
    if (line.startsWith("--- ")) continue;
    if (
      line.startsWith("@@") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ")
    ) {
      if (current === null) continue;
      current ??= mutableFile(files, fallbackPath ?? "Edit");
      current.sourceLines.push({ text: line });
    }
  }
}

function addStructuredPatch(
  files: Map<string, MutableFileChange>,
  path: string,
  value: unknown,
): void {
  if (!Array.isArray(value)) return;
  const file = mutableFile(files, path);
  for (const hunk of value) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) continue;
    const oldStart = numberValue(hunk.oldStart);
    const newStart = numberValue(hunk.newStart);
    hunk.lines.forEach((line, index) => {
      if (typeof line !== "string") return;
      file.sourceLines.push({
        text: line,
        ...(index === 0 && oldStart !== undefined ? { oldStart } : {}),
        ...(index === 0 && newStart !== undefined ? { newStart } : {}),
      });
    });
  }
}

function addReplacement(
  files: Map<string, MutableFileChange>,
  path: string,
  oldText: string,
  newText: string,
) {
  const file = mutableFile(files, path);
  file.sourceLines.push({ text: "@@ -1 +1 @@", oldStart: 1, newStart: 1 });
  oldText.split(/\r?\n/).forEach((line) => {
    file.sourceLines.push({ text: `-${line}` });
  });
  newText.split(/\r?\n/).forEach((line) => {
    file.sourceLines.push({ text: `+${line}` });
  });
}

function collectChangeRecord(
  files: Map<string, MutableFileChange>,
  change: Record<string, unknown>,
  fallbackPath?: string,
) {
  const path =
    nonEmptyString(change.path) ??
    nonEmptyString(change.filePath) ??
    nonEmptyString(change.file_path) ??
    fallbackPath;
  if (!path) return;
  mutableFile(files, path);
  addStructuredPatch(
    files,
    path,
    change.structuredPatch ?? change._structuredPatch,
  );
  const rawPatch =
    nonEmptyString(change.unified_diff) ??
    nonEmptyString(change.rawPatch) ??
    nonEmptyString(change._rawPatch) ??
    nonEmptyString(change.patch);
  if (rawPatch) addRawPatch(files, rawPatch, path, true);
}

function collectChangesValue(
  files: Map<string, MutableFileChange>,
  changes: unknown,
) {
  if (Array.isArray(changes)) {
    for (const change of changes) {
      if (isRecord(change)) collectChangeRecord(files, change);
    }
    return;
  }
  if (!isRecord(changes)) return;
  for (const [path, change] of Object.entries(changes)) {
    if (isRecord(change)) collectChangeRecord(files, change, path);
    else mutableFile(files, path);
  }
}

function renderDiffLines(sourceLines: MutableFileChange["sourceLines"]): {
  additions: number;
  deletions: number;
  lines: CockpitDiffLine[];
  truncated: boolean;
} {
  const lines: CockpitDiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let oldLine = 1;
  let newLine = 1;

  for (const source of sourceLines) {
    const visible = lines.length < MAX_DIFF_LINES;
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(
      source.text,
    );
    if (source.text.startsWith("@@")) {
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
      }
      if (visible) lines.push({ kind: "hunk", text: source.text });
      continue;
    }
    if (source.oldStart !== undefined) oldLine = source.oldStart;
    if (source.newStart !== undefined) newLine = source.newStart;
    if (source.text.startsWith("+")) {
      additions += 1;
      if (visible) {
        lines.push({
          kind: "addition",
          text: source.text.slice(1),
          newLine,
        });
      }
      newLine += 1;
    } else if (source.text.startsWith("-")) {
      deletions += 1;
      if (visible) {
        lines.push({
          kind: "deletion",
          text: source.text.slice(1),
          oldLine,
        });
      }
      oldLine += 1;
    } else {
      const text = source.text.startsWith(" ")
        ? source.text.slice(1)
        : source.text;
      if (visible) lines.push({ kind: "context", text, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return {
    additions,
    deletions,
    lines,
    truncated: sourceLines.length > MAX_DIFF_LINES,
  };
}

function getFileChanges(item: ToolCallItem): CockpitFileChange[] {
  const input = isRecord(item.toolInput) ? item.toolInput : undefined;
  const result = resultValue(item);
  const resultRecord = isRecord(result) ? result : undefined;
  const resultFile = isRecord(resultRecord?.file)
    ? resultRecord.file
    : undefined;
  const files = new Map<string, MutableFileChange>();
  const primaryPath =
    nonEmptyString(input?.file_path) ??
    nonEmptyString(input?.filePath) ??
    nonEmptyString(resultRecord?.filePath) ??
    nonEmptyString(resultFile?.filePath);

  if (primaryPath) mutableFile(files, primaryPath);
  collectChangesValue(files, input?.changes);
  collectChangesValue(files, resultRecord?.changes);

  if (primaryPath) {
    const structuredPatch =
      resultRecord?.structuredPatch ?? input?._structuredPatch;
    addStructuredPatch(files, primaryPath, structuredPatch);
    const oldText =
      nonEmptyString(resultRecord?.oldString) ?? nonEmptyString(input?.old_string);
    const newText =
      nonEmptyString(resultRecord?.newString) ?? nonEmptyString(input?.new_string);
    if (
      (!Array.isArray(structuredPatch) || structuredPatch.length === 0) &&
      oldText !== undefined &&
      newText !== undefined
    ) {
      addReplacement(files, primaryPath, oldText, newText);
    }
    const writeContent =
      typeof input?.content === "string"
        ? input.content
        : typeof resultFile?.content === "string"
          ? resultFile.content
          : undefined;
    if (
      canonicalizeToolName(item.toolName) === "Write" &&
      writeContent !== undefined
    ) {
      const file = mutableFile(files, primaryPath);
      writeContent.split(/\r?\n/).forEach((line) => {
        file.sourceLines.push({ text: `+${line}` });
      });
    }
  }

  const rawPatch =
    nonEmptyString(input?._rawPatch) ??
    nonEmptyString(input?.rawPatch) ??
    nonEmptyString(input?.patch) ??
    nonEmptyString(resultRecord?._rawPatch) ??
    nonEmptyString(resultRecord?.rawPatch);
  if (rawPatch) addRawPatch(files, rawPatch, primaryPath, true);

  return [...files.values()].map((file) => ({
    path: file.path,
    ...renderDiffLines(file.sourceLines),
  }));
}

function getSummary(
  item: ToolCallItem,
  canonicalName: string,
  shell: CockpitShellDisplay | null,
  files: CockpitFileChange[],
): string {
  if (shell) {
    return firstLine(shell.command) || canonicalName;
  }
  if (files.length === 1) return files[0]?.path ?? canonicalName;
  if (files.length > 1) {
    return `${files[0]?.path ?? canonicalName} +${files.length - 1}`;
  }
  if (!KNOWN_TOOL_NAMES.has(canonicalName)) return item.toolName;
  return getFirstStringValue(item.toolInput) || canonicalName;
}

export function createCockpitToolDisplay(
  item: ToolCallItem,
): CockpitToolDisplay {
  const canonicalName = canonicalizeToolName(item.toolName);
  const recognized = KNOWN_TOOL_NAMES.has(canonicalName);
  const shell = SHELL_TOOL_NAMES.has(canonicalName)
    ? getShellDisplay(item, canonicalName)
    : null;
  const files =
    canonicalName === "Edit" || canonicalName === "Write"
      ? getFileChanges(item)
      : [];
  const kind: CockpitToolKind = shell
    ? "shell"
    : files.length > 0
      ? "files"
      : "generic";

  return {
    displayName: canonicalName,
    files,
    kind,
    rawInput: serialize(item.toolInput),
    rawResult: serialize(resultValue(item)),
    recognized,
    shell,
    status: item.status,
    summary: getSummary(item, canonicalName, shell, files),
  };
}
