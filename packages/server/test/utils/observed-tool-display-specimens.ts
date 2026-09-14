import type { NativeDisplayCase } from "./native-tool-display-corpus.js";

// Independent of displayFixtures and display schemas. The observed entries
// retain field presence and nesting from inactive Claude 2.1.223 JSONL inspected
// on 2026-09-10. All paths, prose, identifiers, numbers and media are replaced.
// Live envelopes are reconstructed through convertMessage, not captured SDK
// traffic. SDK-only cases are explicitly distinguished below.
const observed =
  "Sanitized observed Claude Code 2.1.223 persisted shape; reconstructed SDK envelope; inspected 2026-09-10.";
const sdk =
  "Claude Agent SDK 0.3.258 sdk-tools.d.ts control; no local observed specimen; invented values.";
export const observedDisplayCases = [
  {
    id: "claude/WebSearch/observed-mixed",
    provider: "claude",
    tool: "WebSearch",
    provenance: observed,
    expectedKind: "rich",
    expectedOperation: "renderToolResult",
    input: { query: "display contracts" },
    result: {
      query: "display contracts",
      durationSeconds: 0.5,
      searchCount: 1,
      results: [
        {
          tool_use_id: "search-child",
          content: [
            {
              title: "Independent search reference",
              url: "https://example.com/reference",
            },
          ],
        },
        "Provider search commentary",
      ],
    },
    text: "Independent search reference",
  },
  {
    id: "claude/Read/observed-text",
    provider: "claude",
    tool: "Read",
    provenance: observed,
    expectedKind: "rich",
    expectedOperation: "renderToolResult",
    input: { file_path: "/tmp/observed.ts" },
    result: {
      type: "text",
      file: {
        filePath: "/tmp/observed.ts",
        content: "independent file body",
        numLines: 1,
        startLine: 1,
        totalLines: 1,
      },
    },
    text: "independent file body",
  },
  {
    id: "claude/Read/observed-image",
    provider: "claude",
    tool: "Read",
    provenance: observed,
    expectedKind: "rich",
    expectedOperation: "renderToolResult",
    input: { file_path: "/tmp/observed.png" },
    result: {
      type: "image",
      file: {
        type: "image/png",
        base64: "YQ==",
        originalSize: 1,
        dimensions: {
          originalWidth: 10,
          originalHeight: 20,
          displayWidth: 10,
          displayHeight: 20,
        },
      },
    },
    text: "10x20",
  },
  {
    id: "claude/Edit/observed-replacement",
    provider: "claude",
    tool: "Edit",
    provenance: observed,
    expectedKind: "rich",
    expectedOperation: "renderToolResult",
    input: {
      file_path: "/tmp/observed.ts",
      old_string: "before",
      new_string: "independent replacement",
      replace_all: false,
    },
    result: {
      filePath: "/tmp/observed.ts",
      oldString: "before",
      newString: "independent replacement",
      originalFile: "before",
      replaceAll: false,
      userModified: false,
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-before", "+independent replacement"],
        },
      ],
    },
    text: "independent replacement",
  },
  {
    id: "claude/Read/sdk-pdf",
    provider: "claude",
    tool: "Read",
    provenance: sdk,
    expectedKind: "rich",
    expectedOperation: "renderToolResult",
    input: { file_path: "/tmp/native.pdf" },
    result: {
      type: "pdf",
      file: {
        filePath: "/tmp/native.pdf",
        base64: "JVBERi0=",
        originalSize: 1024,
      },
    },
    text: "PDF",
  },
  {
    id: "claude/Read/sdk-image-dimensions",
    provider: "claude",
    tool: "Read",
    provenance: sdk,
    expectedKind: "rich",
    expectedOperation: "renderToolResult",
    input: { file_path: "/tmp/native.png" },
    result: {
      type: "image",
      file: {
        type: "image/png",
        base64: "YQ==",
        dimensions: { originalWidth: 10, originalHeight: 20 },
      },
    },
    text: "10x20",
  },
  {
    id: "claude/Edit/declined",
    provider: "claude",
    tool: "Edit",
    provenance:
      "Synthetic declined-edit lifecycle; existing classification and proposed-diff contract.",
    expectedKind: "rich",
    expectedOperation: "renderToolResult",
    isError: true,
    input: {
      file_path: "/tmp/declined.ts",
      old_string: "before",
      new_string: "after",
    },
    result: "User rejected tool use",
    text: "Declined",
  },
  {
    id: "claude/Task/failed",
    provider: "claude",
    tool: "Task",
    provenance:
      "Synthetic failed-agent lifecycle; retained provider error text in Task disclosure.",
    expectedKind: "rich",
    expectedOperation: "renderInline",
    isError: true,
    input: { prompt: "Inspect", description: "Review" },
    result: "Error: agent timed out",
    text: "agent timed out",
  },
  {
    id: "grok/Read/native-file",
    provider: "grok",
    tool: "Read",
    nativeName: "ReadFile",
    provenance:
      "Synthetic Grok ReadFile ACP state; grok-tool-normalization.ts buildReadResult owner.",
    expectedKind: "rich",
    expectedOperation: "renderToolResult",
    input: { variant: "ReadFile", file_path: "/tmp/grok.ts" },
    rawOutput: {
      type: "ReadFile",
      FileContent: {
        absolute_path: "/tmp/grok.ts",
        content: "Grok file body",
        total_lines: 1,
      },
    },
    result: "Grok file body",
    text: "Grok file body",
  },
  {
    id: "grok/Bash/native-output",
    provider: "grok",
    tool: "Bash",
    nativeName: "Bash",
    provenance:
      "Synthetic Grok Bash ACP state; grok-tool-normalization.ts buildBashResult owner.",
    expectedKind: "rich",
    expectedOperation: "renderToolResult",
    input: { variant: "Bash", command: "printf contract" },
    rawOutput: {
      type: "Bash",
      output_for_prompt: "Grok command output",
      exit_code: 0,
    },
    result: "Grok command output",
    text: "Grok command output",
  },
  ...(["Bash", "Read"] as const).map(
    (tool): NativeDisplayCase => ({
      id: `codex-oss/${tool}/command-execution`,
      provider: "codex-oss",
      tool,
      nativeName: "Bash",
      provenance:
        "Synthetic Codex OSS command_execution at pinned rust-v0.154.0; production OSS adapter paired with rollout normalization.",
      expectedKind: "rich",
      expectedOperation: "renderToolResult",
      input: {
        command: tool === "Read" ? "cat /tmp/oss.ts" : "printf contract",
      },
      rawOutput: "Independent OSS output",
      result: "Process exited with code 0\nOutput:\nIndependent OSS output",
      text: "Independent OSS output",
    }),
  ),
] satisfies NativeDisplayCase[];
