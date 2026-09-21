/**
 * Reconcile the gateway services list with the legacy single-gateway settings.
 *
 * `claudeGatewayUrl` / `claudeGatewayStartCommand` remain the wire form that
 * clients without the `claude-gateway-services` capability read and write, so
 * the two representations must always agree. One entry — the default service —
 * is the mirror; every other entry exists only in the list.
 *
 * Reconciliation is deliberately one-directional per field so an old client's
 * write is never lost: the legacy keys win when they differ from the default
 * entry, because only a legacy write can change them behind the list's back.
 */

import {
  DEFAULT_GATEWAY_SERVICE_ID,
  legacyGatewayServiceEntry,
  type GatewayService,
} from "@yep-anywhere/shared";

export interface LegacyGatewaySettings {
  claudeGatewayUrl?: string;
  claudeGatewayStartCommand?: string;
}

/** The entry the legacy keys mirror, given the configured default id. */
export function defaultGatewayService(
  services: readonly GatewayService[],
  defaultServiceId: string | undefined,
): GatewayService | undefined {
  if (services.length === 0) return undefined;
  const named = defaultServiceId
    ? services.find((service) => service.id === defaultServiceId)
    : undefined;
  return (
    named ??
    services.find((service) => service.id === DEFAULT_GATEWAY_SERVICE_ID) ??
    services[0]
  );
}

/** Which legacy keys this particular update touched, if any. */
export interface LegacyGatewayEdits {
  /** The caller wrote `claudeGatewayUrl`, including writing it empty. */
  legacyUrlEdited?: boolean;
  /** The caller wrote `claudeGatewayStartCommand`, including writing it empty. */
  legacyCommandEdited?: boolean;
}

export interface ReconciledGatewaySettings {
  services: GatewayService[];
  defaultServiceId: string | undefined;
  claudeGatewayUrl: string | undefined;
  claudeGatewayStartCommand: string | undefined;
}

/**
 * Bring both representations into agreement.
 *
 * An installation that has never seen the services UI arrives with only the
 * legacy keys and gets a one-entry list synthesized from them. An installation
 * that uses the list keeps the legacy keys pointed at its default entry, so an
 * older client still edits the gateway it is actually using.
 */
export function reconcileGatewaySettings(
  services: readonly GatewayService[],
  defaultServiceId: string | undefined,
  legacy: LegacyGatewaySettings,
  edits: LegacyGatewayEdits = {},
): ReconciledGatewaySettings {
  const legacyUrl = legacy.claudeGatewayUrl?.trim() || undefined;
  const legacyCommand = legacy.claudeGatewayStartCommand?.trim() || undefined;

  // An older client clearing the gateway URL means "no gateway" for the one
  // entry it can see. Honour that rather than mirroring the entry back and
  // resurrecting the URL it just removed.
  if (edits.legacyUrlEdited && !legacyUrl && services.length > 0) {
    const cleared = defaultGatewayService(services, defaultServiceId);
    const remaining = services.filter((service) => service.id !== cleared?.id);
    return {
      services: remaining,
      defaultServiceId: remaining[0]?.id,
      claudeGatewayUrl: remaining[0]?.url,
      claudeGatewayStartCommand: remaining[0]?.serviceCommand,
    };
  }

  if (services.length === 0) {
    // No list yet. Only a configured legacy URL produces an entry; an unset
    // gateway stays unset rather than gaining an empty service.
    if (!legacyUrl) {
      // A start command with no URL is incomplete, not invalid: the user may
      // be configuring in either order. Keep it rather than discarding it.
      return {
        services: [],
        defaultServiceId: undefined,
        claudeGatewayUrl: undefined,
        claudeGatewayStartCommand: legacyCommand,
      };
    }
    const migrated = legacyGatewayServiceEntry(legacyUrl, legacyCommand);
    return {
      services: [migrated],
      defaultServiceId: migrated.id,
      claudeGatewayUrl: legacyUrl,
      claudeGatewayStartCommand: legacyCommand,
    };
  }

  const active = defaultGatewayService(services, defaultServiceId);
  if (!active) {
    return {
      services: [...services],
      defaultServiceId: undefined,
      claudeGatewayUrl: undefined,
      claudeGatewayStartCommand: undefined,
    };
  }

  // A legacy write that disagrees with the default entry is an older client
  // reconfiguring the gateway; adopt it into that entry.
  const legacyChangedUrl = legacyUrl !== undefined && legacyUrl !== active.url;
  // Only a non-empty legacy value overrides the entry. An absent one is
  // indistinguishable from "this installation stopped mirroring", so treating
  // it as a clear would silently drop a command the list still shows.
  const legacyChangedCommand = edits.legacyCommandEdited
    ? legacyCommand !== active.serviceCommand
    : legacyCommand !== undefined && legacyCommand !== active.serviceCommand;
  let adopted = active;
  if (legacyChangedUrl || legacyChangedCommand) {
    const { serviceCommand, ...rest } = active;
    const command = legacyChangedCommand ? legacyCommand : serviceCommand;
    adopted = {
      ...rest,
      ...(legacyChangedUrl ? { url: legacyUrl } : {}),
      ...(command ? { serviceCommand: command } : {}),
    };
  }

  return {
    services: services.map((service) =>
      service.id === adopted.id ? adopted : service,
    ),
    defaultServiceId: adopted.id,
    claudeGatewayUrl: adopted.url || undefined,
    claudeGatewayStartCommand: adopted.serviceCommand,
  };
}
