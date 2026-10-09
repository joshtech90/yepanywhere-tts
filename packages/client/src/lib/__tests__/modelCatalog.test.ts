import type { ModelInfo } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  buildRouterModelList,
  startsAdditionalModelGroup,
  withProviderVisibleModelSelection,
  withVisibleModelSelection,
} from "../modelCatalog";

describe("model catalog helpers", () => {
  const primary: ModelInfo[] = [{ id: "latest", name: "Latest" }];

  it("does not change membership for a visible selection", () => {
    expect(withVisibleModelSelection(primary, "latest", "Unavailable")).toEqual(
      primary,
    );
  });

  it("keeps a missing saved or live selection visible and separate", () => {
    expect(
      withVisibleModelSelection(primary, "previous", "Unavailable"),
    ).toEqual([
      { id: "latest", name: "Latest" },
      {
        id: "previous",
        name: "previous",
        description: "Unavailable",
        catalogGroup: "additional",
      },
    ]);
  });

  it("does not add an unadvertised Claude Gateway selection", () => {
    expect(
      withProviderVisibleModelSelection(
        "claude-gateway",
        primary,
        "gpt-5.5",
        "Unavailable",
      ),
    ).toEqual(primary);
  });

  it("identifies only the first additional row as a group boundary", () => {
    const models: ModelInfo[] = [
      ...primary,
      { id: "old-1", name: "Old 1", catalogGroup: "additional" },
      { id: "old-2", name: "Old 2", catalogGroup: "additional" },
    ];

    expect(startsAdditionalModelGroup(models, 0)).toBe(false);
    expect(startsAdditionalModelGroup(models, 1)).toBe(true);
    expect(startsAdditionalModelGroup(models, 2)).toBe(false);
  });
});

describe("buildRouterModelList", () => {
  const direct: ModelInfo[] = [
    { id: "default", name: "Default", description: "Recommended" },
    { id: "sonnet", name: "Sonnet", description: "Everyday tasks" },
  ];
  const catalog: ModelInfo[] = [
    {
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      contextWindow: 1_000_000,
      supportsEffort: true,
      supportedReasoningEfforts: [
        { reasoningEffort: "high", description: "High" },
      ],
    },
    {
      id: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      supportsEffort: false,
    },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", supportsEffort: true },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ];
  const cliRows: ModelInfo[] = [
    {
      id: "default",
      name: "Default (recommended)",
      description: "Opus 5.5 with 1M context",
      resolvedModel: "claude-opus-5-5[1m]",
      contextWindow: 1_000_000,
      supportedEffortLevels: ["low", "max"],
    },
    {
      id: "sonnet",
      name: "Sonnet",
      description: "Sonnet 5 for everyday tasks",
      resolvedModel: "claude-sonnet-5",
    },
    { id: "best", name: "Best", description: "Most capable available" },
    {
      id: "haiku",
      name: "Haiku",
      description: "Fastest",
      resolvedModel: "claude-haiku-9",
    },
  ];
  const build = (
    accounts: { cliModels?: ModelInfo[] }[],
    selectedModel: string | null = null,
  ) =>
    buildRouterModelList({
      direct,
      accounts,
      accountModels: catalog,
      routed: true,
      selectedModel,
    });

  it("keeps the CLI's names and descriptions with the launch target's capabilities", () => {
    const { models, unavailable } = build([{ cliModels: cliRows }]);
    expect(models.find((m) => m.id === "default")).toEqual({
      id: "default",
      name: "Default (recommended)",
      description: "Opus 5.5 with 1M context",
      resolvedModel: "claude-opus-5-5[1m]",
      contextWindow: 1_000_000,
      supportsEffort: true,
      supportedReasoningEfforts: [
        { reasoningEffort: "high", description: "High" },
      ],
    });
    expect(models.find((m) => m.id === "sonnet")).toMatchObject({
      description: "Sonnet 5 for everyday tasks",
      supportsEffort: true,
    });
    expect(unavailable.get("default")).toBeUndefined();
    expect(unavailable.get("sonnet")).toBeUndefined();
  });

  it("disables rows without a target the pool can launch", () => {
    const { unavailable } = build([{ cliModels: cliRows }]);
    expect(unavailable.get("best")).toBe("unresolved");
    expect(unavailable.get("haiku")).toBe("missing");
  });

  it("disables an alias the members select differently", () => {
    const { unavailable } = build([
      { cliModels: cliRows },
      {
        cliModels: [{ ...cliRows[1]!, resolvedModel: "claude-sonnet-5-5" }],
      },
    ]);
    expect(unavailable.get("sonnet")).toBe("conflict");
    expect(unavailable.get("default")).toBeUndefined();
  });

  it("groups catalog models no row launches after the CLI rows", () => {
    const { models } = build([{ cliModels: cliRows }]);
    expect(
      models
        .filter((m) => m.catalogGroup === "additional")
        .map((m) => [m.id, m.name]),
    ).toEqual([
      ["claude-sonnet-5-5", "Sonnet 5.5"],
      ["claude-haiku-4-5", "Haiku 4.5"],
    ]);
    expect(models.slice(0, 4).map((m) => m.id)).toEqual([
      "default",
      "sonnet",
      "best",
      "haiku",
    ]);
  });

  it("falls back to the direct rows and a family guess without CLI rows", () => {
    const { models, unavailable } = build([{}]);
    expect(unavailable.size).toBe(0);
    expect(models.find((m) => m.id === "sonnet")).toMatchObject({
      name: "Sonnet",
      supportsEffort: false,
    });
  });

  it("leaves an unrouted list as the direct list plus router-only models", () => {
    const { models, unavailable } = buildRouterModelList({
      direct,
      accounts: [{ cliModels: cliRows }],
      accountModels: catalog,
      routed: false,
      selectedModel: null,
    });
    expect(unavailable.size).toBe(0);
    expect(models.find((m) => m.id === "sonnet")).toBe(direct[1]);
  });
});
