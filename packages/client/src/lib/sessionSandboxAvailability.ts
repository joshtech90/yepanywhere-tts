import {
  SESSION_SANDBOXING_CAPABILITY,
  SESSION_SANDBOXING_STATUS_CAPABILITY,
  SESSION_SANDBOX_NETWORK_FIREWALL_CAPABILITY,
  type SessionSandboxAvailability,
  serverHasCapability,
} from "@yep-anywhere/shared";
import type { TranslationFn } from "../i18n";

export interface SessionSandboxAvailabilitySource {
  capabilities?: readonly string[];
  sessionSandboxing?: SessionSandboxAvailability;
}

/**
 * Require both the runtime-status contract and an actively usable host
 * backend. Intermediate development servers advertised only the protocol
 * capability on unsupported hosts, so that legacy shape must stay hidden.
 */
export function serverHasAvailableSessionSandbox(
  source: SessionSandboxAvailabilitySource | null | undefined,
): boolean {
  return (
    serverHasCapability(source, SESSION_SANDBOXING_STATUS_CAPABILITY) &&
    serverHasCapability(source, SESSION_SANDBOXING_CAPABILITY) &&
    serverHasCapability(source, SESSION_SANDBOX_NETWORK_FIREWALL_CAPABILITY) &&
    source?.sessionSandboxing?.state === "available"
  );
}

/**
 * Why a supported platform cannot offer the sandbox right now, stated where
 * the control would sit so the operator can fix the host. Null when there is
 * nothing to explain: the sandbox is available, the platform is unsupported,
 * or the server predates the status contract.
 */
export function describeUnavailableSessionSandbox(
  source: SessionSandboxAvailabilitySource | null | undefined,
  t: TranslationFn,
): string | null {
  if (!serverHasCapability(source, SESSION_SANDBOXING_STATUS_CAPABILITY)) {
    return null;
  }
  const availability = source?.sessionSandboxing;
  if (!availability) return null;
  if (availability.blocker?.kind === "missing-packages") {
    return t("newSessionSandboxUnavailableMissingPackages", {
      packages: availability.blocker.packages.join(", "),
    });
  }
  if (availability.blocker?.kind === "userns-restricted") {
    return t("newSessionSandboxUnavailableUsernsRestricted");
  }
  switch (availability.state) {
    case "available":
    case "unsupported-platform":
      return null;
    case "missing-bubblewrap":
      // Servers before the blocker field still name this one package.
      return t("newSessionSandboxUnavailableMissingPackages", {
        packages: "bubblewrap",
      });
    case "auth-required":
      // Only older servers refuse the sandbox without local auth.
      return t("newSessionSandboxUnavailableAuthRequired");
    case "untrusted-bubblewrap":
      return t("newSessionSandboxUnavailableUntrusted");
    case "unsupported-version":
      return t("newSessionSandboxUnavailableVersion", {
        version: availability.version ?? "?",
      });
    case "probe-failed":
      return t("newSessionSandboxUnavailableProbeFailed");
  }
}
