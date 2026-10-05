import { homedir } from "node:os";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type {
  ContextBreakdown,
  ContextBreakdownCategory,
  ContextBreakdownCategoryKey,
  ContextBreakdownItem,
} from "@yep-anywhere/shared";

export type ClaudeContextUsageResponse = Awaited<
  ReturnType<Query["getContextUsage"]>
>;

/**
 * Claude names its `/context` rows in English and documents `kind` as the only
 * stable classification. YA keys rows by name prefix solely to attach the
 * matching per-item lists and labels; an unrecognized name stays "other" and
 * still renders under its own name, so a renamed row degrades to plain text.
 */
const KEY_BY_NAME_PREFIX: ReadonlyArray<
  readonly [string, ContextBreakdownCategoryKey]
> = [
  ["System prompt", "systemPrompt"],
  ["System tools", "systemTools"],
  ["MCP tools", "mcpTools"],
  ["Custom agents", "agents"],
  ["Memory files", "memoryFiles"],
  ["Skills", "skills"],
  ["Messages", "messages"],
];

function categoryKey(
  name: string,
  kind: ContextBreakdownCategory["kind"],
): ContextBreakdownCategoryKey {
  if (kind === "free") return "free";
  if (kind === "buffer") return "buffer";
  return (
    KEY_BY_NAME_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1] ??
    "other"
  );
}

function homeRelative(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;
}

function byTokensDescending(items: ContextBreakdownItem[]) {
  return items.sort((left, right) => right.tokens - left.tokens);
}

function itemsFor(
  key: ContextBreakdownCategoryKey,
  kind: ContextBreakdownCategory["kind"],
  usage: ClaudeContextUsageResponse,
  home: string,
): ContextBreakdownItem[] | undefined {
  if (kind !== "used") return undefined;
  switch (key) {
    case "systemPrompt":
      return usage.systemPromptSections?.map(({ name, tokens }) => ({
        label: name,
        tokens,
      }));
    case "systemTools":
      return usage.systemTools?.map(({ name, tokens }) => ({
        label: name,
        tokens,
      }));
    case "mcpTools":
      return usage.mcpTools
        .filter((tool) => tool.isLoaded !== false)
        .map(({ name, serverName, tokens }) => ({
          label: name,
          detail: serverName,
          tokens,
        }));
    case "agents":
      return usage.agents.map(({ agentType, source, tokens }) => ({
        label: agentType,
        detail: source,
        tokens,
      }));
    case "memoryFiles":
      return usage.memoryFiles.map(({ path, type, tokens }) => ({
        label: homeRelative(path, home),
        detail: type,
        tokens,
      }));
    case "skills":
      return usage.skills?.skillFrontmatter.map(({ name, source, tokens }) => ({
        label: name,
        detail: source,
        tokens,
      }));
    default:
      return undefined;
  }
}

/**
 * Project the SDK's `getContextUsage` answer onto YA's provider-neutral
 * breakdown. Zero-token rows are dropped, except the free-space row, which
 * the window meter needs even when empty.
 */
export function normalizeClaudeContextUsage(
  usage: ClaudeContextUsageResponse,
  home: string = homedir(),
): ContextBreakdown {
  const categories: ContextBreakdownCategory[] = [];
  for (const row of usage.categories) {
    if (row.tokens <= 0 && row.kind !== "free") continue;
    const key = categoryKey(row.name, row.kind);
    const category: ContextBreakdownCategory = {
      key,
      name: row.name,
      tokens: row.tokens,
      kind: row.kind,
    };
    const items = itemsFor(key, row.kind, usage, home);
    if (items && items.length > 0) {
      category.items = byTokensDescending(items);
    }
    if (key === "messages" && usage.messageBreakdown) {
      const parts = usage.messageBreakdown;
      category.messageParts = {
        toolCallTokens: parts.toolCallTokens,
        toolResultTokens: parts.toolResultTokens,
        assistantTextTokens: parts.assistantMessageTokens,
        userTextTokens: parts.userMessageTokens,
      };
    }
    categories.push(category);
  }
  return {
    model: usage.model,
    totalTokens: usage.totalTokens,
    maxTokens: usage.maxTokens,
    ...(usage.isAutoCompactEnabled &&
      usage.autoCompactThreshold !== undefined && {
        autoCompactAtTokens: usage.autoCompactThreshold,
      }),
    categories,
  };
}
