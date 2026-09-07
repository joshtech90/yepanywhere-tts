import { decodeCodeModeOutput } from "@yep-anywhere/shared";
import type { Message } from "../../types";
import type { RenderItem, ToolCallItem } from "../../types/renderItems";

export interface WorkflowMarker {
  start: number;
  end: number;
  prefix: string;
  title: string;
  kind: "stage" | "activation" | "unresolved" | "start" | "end";
  path?: string;
  schemaRef?: string;
}

export type WorkflowSchemaFiles = Readonly<Record<string, string | null>>;

export interface WorkflowAnnotation {
  markers: WorkflowMarker[];
  outputText?: string;
  parent?: { path: string; title: string };
  view?: "spans" | "matching-lines";
  visibleRanges?: Array<{ start: number; end: number }>;
}

interface ToolPolicy {
  containsTags: boolean;
  closed?: boolean;
  view?: "spans" | "matching-lines";
  whitelist?: string[];
}

interface Stage {
  title: string;
  policy: ToolPolicy;
  presentation: { collect: boolean; order: number };
}

interface Schema {
  id: string;
  title: string;
  root: string;
  stages: Map<string, Stage>;
  inline?: Set<string>;
}

interface Cursor {
  schema: Schema;
  path: string;
  instance?: string;
}

const ACTIVATION = "@@visualization-schema/1 ";
const NO_TAGS: ToolPolicy = { containsTags: false, closed: false };
const INLINE_POLICY: ToolPolicy = { containsTags: true, view: "spans" };
const SEPARATE: Stage["presentation"] = { collect: false, order: 0 };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function key(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && !/[[\]\r\n]/.test(value)
  );
}

function prefix(line: string): string | undefined {
  return /^(?:\[[^[\]\r\n]+\])+/.exec(line)?.[0];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function policy(value: unknown, inherited: ToolPolicy): ToolPolicy | undefined {
  if (value === undefined) return inherited;
  if (
    !record(value) ||
    (value.containsTags !== undefined &&
      typeof value.containsTags !== "boolean") ||
    (value.closed !== undefined && typeof value.closed !== "boolean")
  )
    return;
  if (
    value.view !== undefined &&
    value.view !== "spans" &&
    value.view !== "matching-lines"
  )
    return;
  if (
    value.whitelist !== undefined &&
    (!Array.isArray(value.whitelist) ||
      !value.whitelist.every(
        (path) => typeof path === "string" && prefix(path) === path,
      ))
  )
    return;
  return {
    containsTags: value.containsTags ?? false,
    closed: value.closed ?? false,
    view: value.view,
    whitelist: value.whitelist as string[] | undefined,
  };
}

function presentation(value: unknown): Stage["presentation"] | undefined {
  if (value === undefined) return SEPARATE;
  if (
    !record(value) ||
    (value.collect !== undefined && typeof value.collect !== "boolean") ||
    (value.order !== undefined &&
      (typeof value.order !== "number" || !Number.isFinite(value.order)))
  )
    return;
  return { collect: value.collect ?? false, order: value.order ?? 0 };
}

function parseSchema(value: unknown): Schema | undefined {
  if (
    !record(value) ||
    value.type !== "tagged-stages/1" ||
    typeof value.id !== "string" ||
    !value.id ||
    /\s/.test(value.id) ||
    !key(value.key) ||
    value.key === "workflow" ||
    typeof value.title !== "string" ||
    !Array.isArray(value.stages)
  )
    return;
  const rootPolicy = policy(value.toolOutput, NO_TAGS);
  const rootPresentation = presentation(value.presentation);
  if (!rootPolicy || !rootPresentation) return;
  const stages = new Map<string, Stage>();
  const root = `[${value.key}]`;
  stages.set(root, {
    title: value.title,
    policy: rootPolicy,
    presentation: rootPresentation,
  });
  function children(
    values: unknown[],
    parent: string,
    inherited: Stage,
    depth: number,
  ): boolean {
    if (depth > 32 || stages.size + values.length > 512) return false;
    for (const child of values) {
      if (
        !record(child) ||
        !key(child.key) ||
        (child.title !== undefined && typeof child.title !== "string") ||
        (child.children !== undefined && !Array.isArray(child.children))
      )
        return false;
      const path = `${parent}[${child.key}]`;
      const childPolicy = policy(child.toolOutput, inherited.policy);
      const childPresentation = presentation(child.presentation);
      if (
        stages.has(path) ||
        stages.size >= 512 ||
        !childPolicy ||
        !childPresentation
      )
        return false;
      const stage = {
        title: `${inherited.title} › ${child.title ?? child.key}`,
        policy: childPolicy,
        presentation: childPresentation,
      };
      stages.set(path, stage);
      if (
        Array.isArray(child.children) &&
        !children(child.children, path, stage, depth + 1)
      )
        return false;
    }
    return true;
  }
  if (!children(value.stages, root, stages.get(root)!, 1)) return;
  return { id: value.id, title: value.title, root, stages };
}

function inlineSchema(operand: string): Schema | undefined {
  const value = parseJson(operand);
  if (!Array.isArray(value)) return;
  const paths: string[] = [];
  for (const entry of value) {
    const atoms = typeof entry === "string" ? [entry] : entry;
    if (!Array.isArray(atoms) || !atoms.length || !atoms.every(key)) return;
    paths.push(atoms.map((atom) => `[${atom}]`).join(""));
  }
  return {
    id: "",
    title: "",
    root: "",
    stages: new Map(),
    inline: new Set(paths),
  };
}

export function workflowSchemaReference(operand: string) {
  if (!/^(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(operand)) return;
  const fragment = operand.indexOf("#");
  return {
    path: fragment < 0 ? operand : operand.slice(0, fragment),
    id: fragment < 0 ? undefined : operand.slice(fragment + 1),
  };
}

// Interpret either a JSON file or a document containing fenced declarations.
// The browser's file resolver supplies bytes separately from transcript text.
export function readWorkflowSchema(
  text: string,
  operand: string,
): Schema | undefined {
  const reference = workflowSchemaReference(operand);
  if (!reference) return;
  const { id } = reference;
  const json = parseJson(text);
  if (record(json)) {
    const schema = parseSchema(json);
    return schema && (id === undefined || schema.id === id)
      ? schema
      : undefined;
  }
  const declarations: Schema[] = [];
  for (const match of text.matchAll(/^```json\s*\r?\n([\s\S]*?)^```\s*$/gm)) {
    const value = parseJson(match[1] ?? "");
    if (!record(value) || (id === undefined ? !value.type : value.id !== id))
      continue;
    const schema = parseSchema(value);
    if (!schema) return;
    declarations.push(schema);
  }
  return declarations.length === 1 ? declarations[0] : undefined;
}

function stage(cursor: Cursor): Stage {
  return (
    cursor.schema.stages.get(cursor.path) ?? {
      title: cursor.path.replace(/\]\[/g, " › ").replace(/^\[|\]$/g, ""),
      policy: cursor.schema.inline ? INLINE_POLICY : NO_TAGS,
      presentation: SEPARATE,
    }
  );
}

function pathTitle(schema: Schema, path: string): string {
  let current = "";
  let title = "";
  for (const atom of path.slice(1, -1).split("][")) {
    current += `[${atom}]`;
    title =
      schema.stages.get(current)?.title ??
      `${title ? `${title} › ` : ""}${atom}`;
  }
  return title;
}

function matchesTool(path: string, cursor: Cursor): boolean {
  if (cursor.schema.inline) return cursor.schema.inline.has(path);
  const effective = stage(cursor).policy;
  return (
    effective.containsTags &&
    (!effective.closed ||
      cursor.schema.stages.has(`${cursor.path}${path}`) ||
      effective.whitelist?.includes(path) === true)
  );
}

function toolOutputParts(item: ToolCallItem): string[] {
  const result = item.toolResult?.structured;
  if (item.toolName === "Exec") {
    const decoded = decodeCodeModeOutput(result ?? item.toolResult?.content);
    if (decoded) {
      const parts = decoded.parts
        .filter((part) => part.kind !== "script-status")
        .map((part) => part.text);
      return parts.length ? parts : [""];
    }
  }
  if (
    item.toolName === "Read" &&
    record(result) &&
    result.type === "text" &&
    record(result.file) &&
    typeof result.file.content === "string"
  ) {
    return [result.file.content];
  }
  return [item.toolResult?.content ?? ""];
}

/** Preserve invocation-time context while visiting results in arrival order. */
export function annotateWorkflowTags(
  messages: Message[],
  items: RenderItem[],
  schemaFiles?: WorkflowSchemaFiles,
): RenderItem[] {
  const events = new Map<
    Message,
    Array<{ item: RenderItem; result: boolean }>
  >();
  const annotations = new Map<RenderItem, WorkflowAnnotation>();
  const calls = new Map<ToolCallItem, { cursor?: Cursor; turn: number }>();
  let turn = 0;
  let cursor: Cursor | undefined;
  let activated: Schema | undefined;
  let declarations = new Map<string, string>();

  for (const item of items) {
    if (item.isSubagent) continue;
    const first = item.sourceMessages[0];
    if (first) {
      const entries = events.get(first) ?? [];
      entries.push({ item, result: false });
      events.set(first, entries);
    }
    if (item.type === "tool_call" && item.toolResult) {
      const resultSource = [...item.sourceMessages]
        .reverse()
        .find((message) => {
          const content = message.message?.content ?? message.content;
          return (
            Array.isArray(content) &&
            content.some(
              (block) =>
                block.type === "tool_result" && block.tool_use_id === item.id,
            )
          );
        });
      if (resultSource) {
        const entries = events.get(resultSource) ?? [];
        entries.push({ item, result: true });
        events.set(resultSource, entries);
      }
    }
  }

  function scan(
    text: string,
    initial: Cursor | undefined,
    tool: boolean,
    streaming: boolean,
  ): WorkflowAnnotation {
    const annotation: WorkflowAnnotation = { markers: [] };
    let local = initial;
    const parent = initial?.path;
    if (initial && parent)
      annotation.parent = { path: parent, title: stage(initial).title };
    if (tool && initial && stage(initial).policy.containsTags)
      annotation.view = stage(initial).policy.view ?? "spans";
    const visibleRanges: Array<{ start: number; end: number }> = [];
    function showLine(start: number, end: number) {
      const previous = visibleRanges.at(-1);
      if (previous && previous.end >= start) previous.end = end;
      else visibleRanges.push({ start, end });
    }
    let fence: string | undefined;
    let offset = 0;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\r$/, "");
      const start = offset;
      offset += raw.length + 1;
      const end = Math.min(offset, text.length);
      if (tool && annotation.view !== "matching-lines") showLine(start, end);
      if (streaming && offset > text.length) break;
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      const insideFence = fence !== undefined;
      if (fenceMatch) {
        if (!fence) fence = fenceMatch;
        else if (
          fenceMatch[0] === fence[0] &&
          fenceMatch.length >= fence.length &&
          /^ {0,3}(?:`+|~+)\s*$/.test(line)
        )
          fence = undefined;
      }
      const marker = (
        kind: WorkflowMarker["kind"],
        matched: string,
        title: string,
        path?: string,
      ) => {
        if (tool) showLine(start, end);
        annotation.markers.push({
          start,
          end: start + matched.length,
          prefix: matched,
          title,
          kind,
          ...(path ? { path } : {}),
        });
      };
      if (!insideFence && !fenceMatch && line.startsWith(ACTIVATION)) {
        const operand = line.slice(ACTIVATION.length).trim();
        const reference = workflowSchemaReference(operand);
        const fileContent = schemaFiles?.[operand];
        const embedded =
          reference && tool ? readWorkflowSchema(text, operand) : undefined;
        const schema = operand.startsWith("[")
          ? inlineSchema(operand)
          : reference
            ? (embedded ?? readWorkflowSchema(fileContent ?? "", operand))
            : undefined;
        const signature =
          schema && !schema.inline
            ? JSON.stringify([...schema.stages])
            : undefined;
        const previous = schema && declarations.get(schema.id);
        if (!schema || (previous !== undefined && previous !== signature)) {
          marker("unresolved", line, operand);
          if (reference) annotation.markers.at(-1)!.schemaRef = operand;
          continue;
        }
        if (signature) declarations.set(schema.id, signature);
        local = schema.inline ? { schema, path: "" } : undefined;
        // A nested script owns its following output, not the caller's cursor.
        // Unscoped schema reads still activate subsequent assistant activity.
        if (!tool || !initial) {
          activated = schema;
          cursor = local;
        }
        if (tool && schema.inline) annotation.view = "spans";
        marker("activation", line, schema.title);
        if (reference && !embedded)
          annotation.markers.at(-1)!.schemaRef = operand;
        continue;
      }
      if (!tool && (insideFence || fenceMatch)) continue;
      const path = prefix(line);
      if (!path) continue;
      if (!tool && !local?.schema.inline && path === "[workflow][start]") {
        const match = /^\[workflow\]\[start\] id=(\S+) schema=(\S+)\s*$/.exec(
          line,
        );
        if (
          match &&
          activated &&
          !activated.inline &&
          activated.id === match[2] &&
          !cursor
        ) {
          cursor = {
            schema: activated,
            path: activated.root,
            instance: match[1],
          };
          local = cursor;
          marker("start", path, activated.title);
        }
      } else if (!tool && !local?.schema.inline && path === "[workflow][end]") {
        const match =
          /^\[workflow\]\[end\] id=(\S+) status=(completed|blocked|failed)(?:\s|$)/.exec(
            line,
          );
        if (match && cursor && cursor.instance === match[1]) {
          marker("end", path, `${cursor.schema.title} · ${match[2]}`);
          cursor = undefined;
          local = undefined;
        }
      } else if (local) {
        const matched = tool
          ? matchesTool(path, local)
          : (local.schema.inline?.has(path) ?? local.schema.stages.has(path));
        if (!matched) continue;
        const fullPath = tool ? `${parent ?? ""}${path}` : path;
        const title =
          tool && initial && initial.schema !== local.schema && parent
            ? `${stage(initial).title} › ${pathTitle(local.schema, path)}`
            : pathTitle(local.schema, fullPath);
        marker("stage", path, title, fullPath);
        if (!tool) {
          cursor = { ...local, path };
          local = cursor;
        }
      }
    }
    if (tool && annotation.view) annotation.visibleRanges = visibleRanges;
    return annotation;
  }

  for (const message of messages) {
    for (const event of events.get(message) ?? []) {
      const { item, result } = event;
      if (
        item.type === "user_prompt" ||
        (item.type === "system" && item.subtype === "compact_boundary")
      ) {
        turn++;
        cursor = undefined;
        activated = undefined;
        declarations = new Map();
      } else if (item.type === "text") {
        annotations.set(
          item,
          scan(item.text, cursor, false, item.isStreaming === true),
        );
      } else if (item.type === "tool_call") {
        if (!result) {
          calls.set(item, { cursor, turn });
          if (cursor?.path)
            annotations.set(item, {
              markers: [],
              parent: { path: cursor.path, title: stage(cursor).title },
            });
        } else {
          const call = calls.get(item);
          if (call?.turn === turn && item.toolResult) {
            const parts = toolOutputParts(item);
            const text = parts.join("\n");
            const annotation: WorkflowAnnotation = { markers: [] };
            const visibleRanges: NonNullable<
              WorkflowAnnotation["visibleRanges"]
            > = [];
            let offset = 0;
            for (const part of parts) {
              // Each result owns its fences and local activation. Joining
              // first would let one command reinterpret a sibling's stdout.
              const current = scan(
                part,
                call.cursor,
                true,
                item.status === "pending",
              );
              annotation.parent = current.parent;
              if (current.view) annotation.view = current.view;
              annotation.markers.push(
                ...current.markers.map((marker) => ({
                  ...marker,
                  start: marker.start + offset,
                  end: marker.end + offset,
                })),
              );
              for (const range of current.visibleRanges ?? [
                { start: 0, end: part.length },
              ]) {
                visibleRanges.push({
                  start: range.start + offset,
                  end: range.end + offset,
                });
              }
              if (offset + part.length < text.length)
                visibleRanges.push({
                  start: offset + part.length,
                  end: offset + part.length + 1,
                });
              offset += part.length + 1;
            }
            if (annotation.view) annotation.visibleRanges = visibleRanges;
            if (annotation.view && text !== item.toolResult.content)
              annotation.outputText = text;
            annotations.set(item, annotation);
          }
        }
      }
    }
  }
  return items.map((item) => {
    const workflow = annotations.get(item);
    return workflow &&
      (workflow.markers.length || workflow.parent || workflow.view)
      ? { ...item, workflow }
      : item;
  });
}
