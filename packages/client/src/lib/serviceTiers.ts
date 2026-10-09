import type { ModelServiceTier } from "@yep-anywhere/shared";

export type ServiceTierMessageKey =
  | "serviceTierStandardLabel"
  | "serviceTierFastLabel"
  | "serviceTierUltraFastLabel"
  | "serviceTierFlexLabel";

export type ServiceTierTranslate = (key: ServiceTierMessageKey) => string;

/** Names for tiers a model catalog no longer lists, e.g. on a stopped session. */
const KNOWN_SERVICE_TIER_KEYS: Record<string, ServiceTierMessageKey> = {
  priority: "serviceTierFastLabel",
  fast: "serviceTierFastLabel",
  ultrafast: "serviceTierUltraFastLabel",
  flex: "serviceTierFlexLabel",
};

/** A missing, empty, or "default" tier is the provider's standard tier. */
export function isStandardServiceTier(id: string | null | undefined): boolean {
  return !id || id === "default";
}

/** Opt-in tiers to offer beside Standard; YA never selects one implicitly. */
export function selectableServiceTiers(
  tiers: readonly ModelServiceTier[] | undefined,
): ModelServiceTier[] {
  return (tiers ?? []).filter((tier) => !isStandardServiceTier(tier.id));
}

export function serviceTierLabel(
  id: string | null | undefined,
  tiers: readonly ModelServiceTier[] | undefined,
  t: ServiceTierTranslate,
): string {
  if (!id || isStandardServiceTier(id)) return t("serviceTierStandardLabel");
  const catalogName = tiers?.find((tier) => tier.id === id)?.name;
  if (catalogName) return catalogName;
  const key = KNOWN_SERVICE_TIER_KEYS[id];
  return key ? t(key) : id;
}
