import {
  type ModelInfo,
  type ProviderName,
  resolveRouterModel,
  routerAliasTargets,
  routerCliModelTarget,
} from "@yep-anywhere/shared";
import { providerRequiresAdvertisedModel } from "./newSessionDefaults";

/**
 * Keep a saved or live model choice visible even when it is absent from the
 * server's current opt-in catalog. The provider still receives the exact id.
 */
export function withVisibleModelSelection(
  models: readonly ModelInfo[],
  selectedModelId: string | null | undefined,
  unavailableDescription: string,
): ModelInfo[] {
  if (
    !selectedModelId ||
    models.some((model) => model.id === selectedModelId)
  ) {
    return [...models];
  }

  return [
    ...models,
    {
      id: selectedModelId,
      name: selectedModelId,
      description: unavailableDescription,
      catalogGroup: "additional",
    },
  ];
}

export function withProviderVisibleModelSelection(
  providerName: ProviderName | null | undefined,
  models: readonly ModelInfo[],
  selectedModelId: string | null | undefined,
  unavailableDescription: string,
): ModelInfo[] {
  if (providerRequiresAdvertisedModel(providerName)) {
    return [...models];
  }
  return withVisibleModelSelection(
    models,
    selectedModelId,
    unavailableDescription,
  );
}

export function startsAdditionalModelGroup(
  models: readonly ModelInfo[],
  index: number,
): boolean {
  return (
    models[index]?.catalogGroup === "additional" &&
    models[index - 1]?.catalogGroup !== "additional"
  );
}

/** Why a routed row cannot launch on the selected pool. */
export type RouterModelUnavailable = "unresolved" | "conflict" | "missing";

export interface RouterModelList {
  models: ModelInfo[];
  unavailable: Map<string, RouterModelUnavailable>;
}

const CATALOG_CAPABILITIES = [
  "contextWindow",
  "supportsEffort",
  "supportedReasoningEfforts",
  "defaultReasoningEffort",
  "supportsAdaptiveThinking",
] as const;

/**
 * The model list for a new session that may route through agent-auth-router.
 *
 * With a routed selection and accounts that carry their own Claude CLI rows,
 * the rows are those (mapped by YA's server like the direct list), so names
 * and descriptions match the direct picker. Each row launches the concrete id
 * its accounts' CLIs report; a row they report none for, disagree on, or whose
 * target no member's catalog has stays listed but unavailable. Effort and
 * thinking come from the catalog entry the row launches, since the router
 * admits against that. Catalog models no row launches follow as additional
 * models. Older routers fall back to the direct rows and a family guess.
 */
export function buildRouterModelList(params: {
  direct: readonly ModelInfo[];
  /** The selected pool's enabled members, or every router account unrouted. */
  accounts: readonly { cliModels?: ModelInfo[] }[];
  /** Union of those accounts' provider catalogs. */
  accountModels: readonly ModelInfo[];
  routed: boolean;
  selectedModel: string | null;
}): RouterModelList {
  const { direct, accounts, accountModels, routed, selectedModel } = params;
  const unavailable = new Map<string, RouterModelUnavailable>();
  const aliases = routerAliasTargets(accounts);
  if (!routed || !aliases.size) {
    const merged = new Map(direct.map((m) => [m.id, m]));
    for (const m of accountModels) {
      const representedByAlias = direct.some(
        (d) =>
          d.id !== m.id && resolveRouterModel(d.id, accountModels) === m.id,
      );
      if (representedByAlias && selectedModel !== m.id) continue;
      if (!merged.has(m.id) || routed) merged.set(m.id, m);
    }
    if (routed)
      for (const m of direct) {
        const target = resolveRouterModel(m.id, accountModels);
        const catalog = accountModels.find((a) => a.id === target);
        if (catalog) merged.set(m.id, { ...catalog, id: m.id, name: m.name });
      }
    return { models: [...merged.values()], unavailable };
  }

  const rows = new Map<string, ModelInfo>();
  for (const account of accounts)
    for (const row of account.cliModels ?? [])
      if (!rows.has(row.id)) rows.set(row.id, row);
  const launched = new Set<string>();
  const models = [...rows.values()].map((row): ModelInfo => {
    const target = accountModels.some((m) => m.id === row.id)
      ? row.id
      : aliases.get(row.id);
    const catalog = accountModels.find((m) => m.id === target);
    if (!target || !catalog) {
      unavailable.set(
        row.id,
        target
          ? "missing"
          : accounts.some((a) =>
                a.cliModels?.some(
                  (m) => m.id === row.id && routerCliModelTarget(m),
                ),
              )
            ? "conflict"
            : "unresolved",
      );
      return row;
    }
    launched.add(catalog.id);
    const {
      supportedEffortLevels: _levels,
      defaultEffortLevel: _default,
      ...described
    } = row;
    const capabilities = Object.fromEntries(
      CATALOG_CAPABILITIES.flatMap((key) =>
        catalog[key] === undefined ? [] : [[key, catalog[key]]],
      ),
    );
    return {
      ...described,
      ...capabilities,
      ...(row.contextWindow ? { contextWindow: row.contextWindow } : {}),
    };
  });
  for (const m of accountModels)
    if (!rows.has(m.id) && (!launched.has(m.id) || selectedModel === m.id))
      models.push({
        ...m,
        name: m.name.replace(/^Claude /, ""),
        catalogGroup: "additional",
      });
  return { models, unavailable };
}
