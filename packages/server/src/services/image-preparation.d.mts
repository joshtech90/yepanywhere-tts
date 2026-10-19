import type { ProviderImageSizing } from "@yep-anywhere/shared";

export function getProviderImageSizing(
  providerName: string,
  model?: string,
): ProviderImageSizing & {
  profiles: NonNullable<ProviderImageSizing["profiles"]>;
};
