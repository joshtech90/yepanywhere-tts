import { execFileSync } from "node:child_process";
import type { Message } from "../src/types";

// Snapshot of the local /publish declaration. Every operation below only
// writes stdout; no publishing script, Git command, or network client runs.
export const publishSchema = {
  type: "tagged-stages/1",
  id: "ya-publish/1",
  key: "publish",
  title: "Publish YA",
  toolOutput: { containsTags: false },
  stages: [
    { key: "prepare", title: "Inspect work and commit completed changes" },
    { key: "integrate", title: "Integrate upstream history" },
    { key: "verify", title: "Verify the source change" },
    { key: "source", title: "Push the authorized source targets" },
    {
      key: "client",
      title: "Publish the hosted client",
      toolOutput: { containsTags: false },
      children: [
        { key: "prepare", title: "Check the Pages checkout and remote" },
        {
          key: "build",
          title: "Build the remote client",
          children: [
            { key: "shared", title: "Build the shared package" },
            { key: "types", title: "Check client types" },
            { key: "bundle", title: "Build with the default relay" },
            { key: "relay", title: "Check the baked relay host" },
          ],
        },
        { key: "copy", title: "Copy assets and entry-point HTML" },
        { key: "commit", title: "Review and commit assets" },
        { key: "check", title: "Check outgoing history and attribution" },
        { key: "push", title: "Push the Pages commit" },
      ],
    },
  ],
};

export function assistant(id: string, text: string): Message {
  return { id, role: "assistant", content: [{ type: "text", text }] };
}

export function call(id: string, name = "Bash"): Message {
  return {
    id: `${id}-call`,
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id,
        name,
        input: { command: "node -e 'console.log(\"SIMULATION ONLY\")'" },
      },
    ],
  };
}

export function result(id: string, content: string): Message {
  return {
    id: `${id}-result`,
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content }],
  };
}

function stdout(text: string): string {
  return execFileSync(
    process.execPath,
    ["-e", "process.stdout.write(process.argv[1])", text],
    {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

// Shapes observed in Codex custom_tool_call_output, including this publish's
// Promise.allSettled wrapper. The fixture's underlying tools remain inert.
export function asCodeMode(
  messages: Message[],
  format: "text" | "command" | "settled",
): Message[] {
  return messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((block) => {
          if (block.type === "tool_use") {
            return {
              ...block,
              name: "Exec",
              input: {
                calls: [{ toolName: "exec_command", input: block.input }],
                source: "// Inert recorded code-mode fixture",
              },
            };
          }
          if (block.type !== "tool_result") return block;
          const command = {
            chunk_id: "workflow-fixture",
            wall_time_seconds: 0,
            exit_code: 0,
            output: block.content,
          };
          return {
            ...block,
            content: JSON.stringify([
              {
                type: "input_text",
                text: "Script completed\nWall time 0 seconds\nOutput:\n",
              },
              {
                type: "input_text",
                text:
                  format === "text"
                    ? block.content
                    : JSON.stringify(
                        format === "command"
                          ? command
                          : { i: 0, status: "fulfilled", value: command },
                      ),
              },
            ]),
          };
        })
      : message.content,
  }));
}

export function simulatedPublish(schemaReference?: string): Message[] {
  const declaration = schemaReference
    ? `@@visualization-schema/1 ${schemaReference}\n`
    : "@@visualization-schema/1 /simulated/publish-workflow.md#ya-publish/1\n```json\n" +
      JSON.stringify(publishSchema, null, 2) +
      "\n```\n";
  return [
    {
      id: "publish-user",
      role: "user",
      content: "Simulate /publish. Do not merge, push, or deploy.",
    },
    call("schema"),
    result("schema", stdout(declaration)),
    assistant(
      "publish-start",
      "[workflow][start] id=publish-simulation schema=ya-publish/1",
    ),
    assistant(
      "publish-prepare",
      "[publish][prepare] Inspect the simulated checkout.",
    ),
    assistant(
      "publish-integrate",
      "[publish][integrate] Upstream integration intentionally skipped.",
    ),
    assistant(
      "publish-verify",
      "[publish][verify] Run a harmless stdout-only tool.",
    ),
    call("verify"),
    result("verify", stdout("SIMULATION: source checks passed\n")),
    assistant(
      "publish-source",
      "[publish][source] Source pushes intentionally skipped.",
    ),
    assistant(
      "publish-client",
      "[publish][client] Exercise the publisher's opaque output.",
    ),
    call("pages"),
    result(
      "pages",
      stdout(
        "PUBLISH: simulated asset preparation\n[copy] This is ordinary output, not an observable child stage.\nPUBLISH: preparation only; nothing deployed\n",
      ),
    ),
    assistant(
      "publish-end",
      "[workflow][end] id=publish-simulation status=completed Simulation finished. Nothing merged, pushed, or deployed.",
    ),
  ];
}

export function simulatedInline(): Message[] {
  return [
    {
      id: "inline-user",
      role: "user",
      content: "Exercise inline workflow tags with a harmless tool.",
    },
    assistant(
      "inline-activation",
      '@@visualization-schema/1 ["build",["check","types"],"report"]',
    ),
    assistant("inline-build", "[build] Prepare the test fixture."),
    call("inline-tool"),
    assistant(
      "inline-report",
      "[report] This later stage must not adopt the earlier tool's output.",
    ),
    result(
      "inline-tool",
      stdout(
        "[check][types] Simulated type check passed.\n[INFO] Ordinary diagnostic remains in this span.\n[build][extra] Not whitelisted.\n[report] Tool completed.\n",
      ),
    ),
    assistant(
      "inline-revisit",
      "[build] Revisit the first stage in chronological order.\n[report] Simulation complete.",
    ),
  ];
}

export function simulatedNestedTool(
  mode: "inherited" | "self-announced" | "matching-lines",
): Message[] {
  const schema = {
    ...publishSchema,
    id: `publish-nested-${mode}/1`,
    stages: publishSchema.stages.map((stage) =>
      stage.key === "client"
        ? {
            ...stage,
            toolOutput: {
              containsTags: mode !== "self-announced",
              closed: true,
              view: mode === "matching-lines" ? "matching-lines" : "spans",
              whitelist: mode === "matching-lines" ? ["[inherited]"] : [],
            },
          }
        : stage,
    ),
  };
  const output =
    mode === "inherited"
      ? ""
      : '[INFO] Before the script declaration.\n[unlisted] Before activation.\n@@visualization-schema/1 [["build","types"],"copy"]\n';
  return [
    {
      id: "nested-user",
      role: "user",
      content: "Simulate a nested script. No merge, push, or deployment.",
    },
    call("nested-schema"),
    result(
      "nested-schema",
      stdout(
        `@@visualization-schema/1 /simulated/nested.md#${schema.id}\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\`\n`,
      ),
    ),
    assistant(
      "nested-start",
      `[workflow][start] id=nested schema=${schema.id}\n[publish][client] Run the harmless script.`,
    ),
    call("nested-script"),
    assistant(
      "nested-advance",
      "[publish][verify] The agent advances while the script runs.",
    ),
    result(
      "nested-script",
      stdout(
        output +
          "[build][types] Simulated types passed.\n[INFO] Diagnostic after activation.\n[copy] Simulated assets prepared.\n",
      ),
    ),
    assistant(
      "nested-resume",
      "[publish][source] The outer workflow continues. No push performed.",
    ),
    call("after-script"),
    result("after-script", stdout("SIMULATION: outer context retained\n")),
    assistant(
      "nested-end",
      "[workflow][end] id=nested status=completed Simulation finished. Nothing merged, pushed, or deployed.",
    ),
  ];
}
