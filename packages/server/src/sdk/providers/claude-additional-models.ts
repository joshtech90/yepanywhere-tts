import type {
  ClaudeAdditionalModelSelection,
  ModelInfo,
} from "@yep-anywhere/shared";

const CLAUDE_ADDITIONAL_MODEL_REGISTRY = [
  {
    id: "claude-fable-5",
    name: "Fable 5",
    description: "Previous Fable generation · full 1M context",
    contextWindow: 1_000_000,
    catalogGroup: "additional",
  },
  {
    id: "claude-opus-5",
    name: "Opus 5",
    description: "Previous Opus generation · full 1M context",
    contextWindow: 1_000_000,
    catalogGroup: "additional",
  },
  {
    id: "claude-sonnet-5",
    name: "Sonnet 5",
    description: "Previous Sonnet generation · full 1M context",
    contextWindow: 1_000_000,
    catalogGroup: "additional",
  },
  {
    id: "claude-opus-4-8",
    name: "Opus 4.8",
    description: "Previous Opus generation · full 1M context",
    contextWindow: 1_000_000,
    catalogGroup: "additional",
  },
  {
    id: "claude-opus-4-6",
    name: "Opus 4.6",
    description: "Previous Opus generation · 200K default context",
    contextWindow: 200_000,
    catalogGroup: "additional",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Sonnet 4.6",
    description: "Previous Sonnet generation · 200K default context",
    contextWindow: 200_000,
    catalogGroup: "additional",
  },
] as const satisfies readonly ModelInfo[];

export function getClaudeAdditionalModelOptions(): ModelInfo[] {
  return CLAUDE_ADDITIONAL_MODEL_REGISTRY.map((model) => ({ ...model }));
}

/**
 * The chooser catalog: the primary rows, then the opted-in previous models in
 * saved order. A catalog row already marked additional — a concrete previous
 * version the live catalog lists — appears only once selected, and then keeps
 * its live capabilities under the registry's label, description and context
 * window.
 */
export function projectClaudeAdditionalModels(
  catalog: readonly ModelInfo[],
  selections: readonly ClaudeAdditionalModelSelection[] | undefined,
): ModelInfo[] {
  const primaryModels = catalog.filter(
    (model) => model.catalogGroup !== "additional",
  );
  if (!selections || selections.length === 0) {
    return primaryModels;
  }

  const registryById = new Map<string, ModelInfo>(
    CLAUDE_ADDITIONAL_MODEL_REGISTRY.map((model) => [model.id, model]),
  );
  const liveById = new Map(
    catalog
      .filter((model) => model.catalogGroup === "additional")
      .map((model) => [model.id, model]),
  );
  const visibleIds = new Set(primaryModels.map((model) => model.id));
  const projected = [...primaryModels];

  for (const selection of selections) {
    if (visibleIds.has(selection.id)) continue;

    const registered = registryById.get(selection.id);
    const live = liveById.get(selection.id);
    projected.push(
      registered || live
        ? {
            ...live,
            ...registered,
            id: selection.id,
            name: registered?.name ?? live?.name ?? selection.label,
            catalogGroup: "additional",
          }
        : {
            id: selection.id,
            name: selection.label,
            description:
              selection.origin === "registry"
                ? "Previously enabled model · no longer maintained by this server"
                : "Custom model ID",
            catalogGroup: "additional",
          },
    );
    visibleIds.add(selection.id);
  }

  return projected;
}

export function getClaudeModelCatalogCacheKey(
  selections: readonly ClaudeAdditionalModelSelection[] | undefined,
): string {
  return JSON.stringify(selections ?? []);
}
