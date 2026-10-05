import { describe, expect, it } from "vitest";
import {
  type ClaudeContextUsageResponse,
  normalizeClaudeContextUsage,
} from "../../../src/sdk/providers/claude-context-breakdown.js";

/**
 * Trimmed from a real `getContextUsage({ detail: "full" })` answer (Agent SDK
 * 0.3.283, Haiku, one Bash call), plus the rows YA's own launches add.
 */
function usage(): ClaudeContextUsageResponse {
  return {
    categories: [
      { name: "System prompt", tokens: 4900, color: "", kind: "used" },
      { name: "System tools", tokens: 9627, color: "", kind: "used" },
      {
        name: "System tools (deferred)",
        tokens: 15933,
        color: "",
        isDeferred: true,
        kind: "deferred",
      },
      { name: "MCP tools", tokens: 0, color: "", kind: "used" },
      { name: "Memory files", tokens: 27478, color: "", kind: "used" },
      { name: "Skills", tokens: 1985, color: "", kind: "used" },
      { name: "Messages", tokens: 3364, color: "", kind: "used" },
      { name: "Something new", tokens: 12, color: "", kind: "used" },
      { name: "Free space", tokens: 157546, color: "", kind: "free" },
    ],
    totalTokens: 42454,
    maxTokens: 200000,
    rawMaxTokens: 200000,
    percentage: 21,
    gridRows: [],
    model: "claude-haiku-4-5-20251001",
    memoryFiles: [
      { path: "/home/u/proj/CLAUDE.md", type: "Project", tokens: 12 },
      { path: "/home/u/.claude/CLAUDE.md", type: "User", tokens: 17488 },
      { path: "/elsewhere/CLAUDE.local.md", type: "Local", tokens: 9978 },
    ],
    mcpTools: [],
    systemTools: [
      { name: "Read", tokens: 900 },
      { name: "Bash", tokens: 2400 },
    ],
    agents: [],
    skills: {
      totalSkills: 2,
      includedSkills: 2,
      tokens: 1985,
      skillFrontmatter: [
        { name: "almanac", source: "userSettings", tokens: 90 },
        { name: "dataviz", source: "plugin", tokens: 610 },
      ],
    },
    autoCompactThreshold: 167000,
    isAutoCompactEnabled: true,
    messageBreakdown: {
      toolCallTokens: 41,
      toolResultTokens: 25,
      attachmentTokens: 49537,
      assistantMessageTokens: 386,
      userMessageTokens: 12,
      redirectedContextTokens: 0,
      unattributedTokens: 0,
      toolCallsByType: [],
      attachmentsByType: [],
    },
    apiUsage: null,
  };
}

describe("normalizeClaudeContextUsage", () => {
  it("keys known rows, keeps unknown ones by name, and drops empty rows", () => {
    const breakdown = normalizeClaudeContextUsage(usage(), "/home/u");
    expect(
      breakdown.categories.map(({ key, name, kind }) => [key, name, kind]),
    ).toEqual([
      ["systemPrompt", "System prompt", "used"],
      ["systemTools", "System tools", "used"],
      ["systemTools", "System tools (deferred)", "deferred"],
      ["memoryFiles", "Memory files", "used"],
      ["skills", "Skills", "used"],
      ["messages", "Messages", "used"],
      ["other", "Something new", "used"],
      ["free", "Free space", "free"],
    ]);
    expect(breakdown).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      totalTokens: 42454,
      maxTokens: 200000,
      autoCompactAtTokens: 167000,
    });
  });

  it("attaches per-item rows largest first, home-relative for files", () => {
    const byKey = new Map(
      normalizeClaudeContextUsage(usage(), "/home/u").categories.map(
        (category) => [`${category.key}:${category.kind}`, category],
      ),
    );
    expect(byKey.get("memoryFiles:used")?.items).toEqual([
      { label: "~/.claude/CLAUDE.md", detail: "User", tokens: 17488 },
      { label: "/elsewhere/CLAUDE.local.md", detail: "Local", tokens: 9978 },
      { label: "~/proj/CLAUDE.md", detail: "Project", tokens: 12 },
    ]);
    expect(byKey.get("skills:used")?.items?.map((item) => item.label)).toEqual([
      "dataviz",
      "almanac",
    ]);
    expect(
      byKey.get("systemTools:used")?.items?.map((item) => item.label),
    ).toEqual(["Bash", "Read"]);
    expect(byKey.get("systemTools:deferred")?.items).toBeUndefined();
  });

  it("splits the conversation row from the SDK's message breakdown", () => {
    const messages = normalizeClaudeContextUsage(
      usage(),
      "/home/u",
    ).categories.find((category) => category.key === "messages");
    expect(messages?.messageParts).toEqual({
      toolCallTokens: 41,
      toolResultTokens: 25,
      assistantTextTokens: 386,
      userTextTokens: 12,
    });
  });

  it("omits the split and the compaction point when the SDK does", () => {
    const raw = usage();
    raw.messageBreakdown = undefined;
    raw.isAutoCompactEnabled = false;
    const breakdown = normalizeClaudeContextUsage(raw, "/home/u");
    expect(breakdown.autoCompactAtTokens).toBeUndefined();
    expect(
      breakdown.categories.find((category) => category.key === "messages")
        ?.messageParts,
    ).toBeUndefined();
  });
});
