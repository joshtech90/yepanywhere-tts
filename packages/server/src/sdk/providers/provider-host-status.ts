let providerHostDegraded = false;

/**
 * Records the outcome of the boot attempt. Whether a provider host is
 * enabled and possible on this platform and launch is decided by
 * `providerHostEnabled` and `supportsProviderHostRuntimeAsLaunched` in
 * `provider-runtime-host.ts`; this module only stores the answer it is given.
 */
export function setProviderHostDegraded(degraded: boolean): void {
  providerHostDegraded = degraded;
}

export function resetProviderHostDegradedForTests(): void {
  providerHostDegraded = false;
}

/** Boot tried to attach or start the provider host and still has none. */
export function isProviderHostDegraded(): boolean {
  return providerHostDegraded;
}
