import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveRouterModel,
  routerAliasTargets,
  sanitizeRouterCliModels,
  type ModelInfo,
} from "../src/index.js";

// Copied from agent-auth-router test/fixtures/contract/selection-claude.json.
// Refresh both together when the router contract changes.
const selection = JSON.parse(
  readFileSync(
    new URL("./fixtures/aar-selection-claude.json", import.meta.url),
    "utf-8",
  ),
) as {
  accounts: {
    models: ModelInfo[];
    catalogAt: string;
    cliModels: unknown;
    cliModelsAt: string;
  }[];
};

describe("agent-auth-router CLI model contract", () => {
  it("accepts the router's selection fixture unchanged", () => {
    const account = selection.accounts[0]!;
    expect(account.catalogAt).toBeTruthy();
    expect(account.cliModelsAt).toBeTruthy();
    const rows = sanitizeRouterCliModels(account.cliModels);
    expect(rows).toEqual(account.cliModels);
    expect(rows?.map((row) => [row.value, row.resolvedModel ?? null])).toEqual([
      ["default", "claude-opus-fixture-2"],
      ["sonnet", "claude-sonnet-fixture-2"],
      ["haiku", "claude-haiku-fixture-1"],
      ["opusplan", null],
    ]);
  });

  it("bounds and type-checks rows regardless of the router", () => {
    expect(sanitizeRouterCliModels(null)).toBeUndefined();
    const rows = sanitizeRouterCliModels([
      ...Array.from({ length: 70 }, (_, index) => ({
        value: `m${index}`,
        displayName: "N".repeat(500),
        description: "D".repeat(500),
        resolvedModel: index === 0 ? "x".repeat(201) : 7,
        supportsFastMode: "yes",
        extra: "dropped",
      })),
    ]);
    expect(rows).toHaveLength(64);
    expect(rows?.[0]).toEqual({
      value: "m0",
      displayName: "N".repeat(200),
      description: "D".repeat(300),
    });
    expect(sanitizeRouterCliModels([null, { displayName: "x" }])).toEqual([]);
  });
});

describe("resolveRouterModel", () => {
  const catalog: ModelInfo[] = [
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  ];
  const row = (id: string, resolvedModel?: string): ModelInfo => ({
    id,
    name: id,
    ...(resolvedModel ? { resolvedModel } : {}),
  });

  it("uses the accounts' CLI targets instead of the newest family member", () => {
    const aliases = routerAliasTargets([
      {
        cliModels: [
          row("sonnet", "claude-sonnet-5"),
          row("opus", "claude-opus-5-5[1m]"),
          row("best"),
        ],
      },
    ]);
    expect(resolveRouterModel("sonnet", catalog)).toBe("claude-sonnet-5-5");
    expect(resolveRouterModel("sonnet", catalog, aliases)).toBe(
      "claude-sonnet-5",
    );
    expect(resolveRouterModel("opus", catalog, aliases)).toBe(
      "claude-opus-5-5",
    );
    expect(resolveRouterModel("best", catalog, aliases)).toBeUndefined();
    expect(
      resolveRouterModel("haiku", catalog, aliases),
      "no family guess once CLI rows exist",
    ).toBeUndefined();
    expect(resolveRouterModel("claude-sonnet-5-5", catalog, aliases)).toBe(
      "claude-sonnet-5-5",
    );
  });

  it("refuses an alias the pool's accounts resolve differently", () => {
    const aliases = routerAliasTargets([
      { cliModels: [row("sonnet", "claude-sonnet-5")] },
      { cliModels: [row("sonnet", "claude-sonnet-5-5")] },
      {},
    ]);
    expect(aliases.get("sonnet")).toBeNull();
    expect(resolveRouterModel("sonnet", catalog, aliases)).toBeUndefined();
  });
});
