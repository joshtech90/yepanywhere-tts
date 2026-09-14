// biome-ignore-all lint/complexity/useLiteralKeys: Typed access to production adapter seams, without visibility-erasing casts.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeProvider } from "../../src/sdk/providers/claude.js";
import { ClaudeSessionReader } from "../../src/sessions/reader.js";
import {
  claudeDisplayRecords,
  readClaudeDisplayEntries,
  type NativeDisplayCase,
} from "./native-tool-display-corpus.js";
import { runStreamPipeline } from "./render-parity-harness.js";

const fixtures: NativeDisplayCase[] = [
  {
    id: "lifecycle/rejected",
    provider: "claude",
    tool: "Write",
    input: { content: "retained rejected body" },
    result: "Missing file_path",
    isError: true,
    text: "Missing file_path",
  },
  {
    id: "lifecycle/corrected",
    provider: "claude",
    tool: "Write",
    input: { file_path: "/tmp/recovered.ts", content: "recovered body" },
    result: "File written",
    text: "File written",
  },
];

/** Two ordered calls, observed before/after each terminal result. Prefixes are
 * rebuilt through the production adapter and JSONL reader, not normalized rows. */
export async function runNativeDisplayLifecycle(prefix: number) {
  const records = fixtures.map(claudeDisplayRecords);
  const provider = new ClaudeProvider();
  const live = records
    .flatMap(({ use, result }) => [
      provider["convertMessage"](use),
      provider["convertMessage"](result),
    ])
    .slice(0, prefix);
  const entries = records.flatMap((record) => record.entries).slice(0, prefix);
  for (let index = 1; index < entries.length; index++) {
    const entry = entries[index];
    const previous = entries[index - 1];
    if (entry && previous && "parentUuid" in entry && "uuid" in previous)
      entry.parentUuid = previous.uuid;
  }
  return {
    live: await runStreamPipeline(live, {
      activeToolApproval: prefix % 2 === 1,
    }),
    durable: await readClaudeDisplayEntries(entries),
  };
}

/** Current Claude child history lives in a separate file. The sidecar owns the
 * launch link; we verify it instead of inventing parent fields in child JSONL. */
export async function runNativeDisplayOwnership() {
  const parent = claudeDisplayRecords({
    id: "ownership/parent",
    provider: "claude",
    tool: "Task",
    input: { prompt: "Review files", description: "Review child" },
    result: {
      status: "completed",
      agentId: "review-child",
      content: [{ type: "text", text: "Child completed" }],
    },
    text: "Child completed",
  });
  const childRecords = fixtures.map(claudeDisplayRecords);
  const childEntries = childRecords.flatMap((record) => record.entries);
  for (let index = 1; index < childEntries.length; index++) {
    const entry = childEntries[index];
    const previous = childEntries[index - 1];
    if (entry && previous && "parentUuid" in entry && "uuid" in previous)
      entry.parentUuid = previous.uuid;
  }
  const parentId = parent.use.message.content[0]?.id;
  if (!parentId) throw new Error("Missing parent tool id");
  const directory = await mkdtemp(join(tmpdir(), "ya-display-child-"));
  try {
    const children = join(directory, "display-corpus", "subagents");
    await mkdir(children, { recursive: true });
    await writeFile(
      join(children, "agent-review-child.jsonl"),
      childEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
    await writeFile(
      join(children, "agent-review-child.meta.json"),
      JSON.stringify({ agentType: "general-purpose", toolUseId: parentId }),
    );
    const reader = new ClaudeSessionReader({ sessionDir: directory });
    const child = await reader.getAgentSession(
      "review-child",
      "display-corpus",
    );
    const mappings = await reader.getAgentMappings("display-corpus");
    const provider = new ClaudeProvider();
    const liveMessages = childRecords.flatMap(({ use, result }) => [
      provider["convertMessage"]({ ...use, parent_tool_use_id: parentId }),
      provider["convertMessage"]({ ...result, parent_tool_use_id: parentId }),
    ]);
    return {
      parentId,
      mappings,
      liveMessages,
      parent: await readClaudeDisplayEntries(parent.entries),
      live: await runStreamPipeline(liveMessages),
      // getAgentSession already invokes the production child-message converter;
      // apply the ordinary augmentation/compiler path to those converted rows.
      durable: await runStreamPipeline(child.messages),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
