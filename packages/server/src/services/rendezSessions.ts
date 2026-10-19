import { getProviderImageSizing } from "./image-preparation.mjs";
import {
  getProviderHostInventory,
  getProviderHostSessionTurnStatus,
  isProviderRuntimeHostAvailable,
  streamProviderHostSessionTurn,
} from "../sdk/providers/provider-runtime-host.js";
import type { Process } from "../supervisor/Process.js";
import {
  RENDEZ_DEFAULT_PROFILE,
  type RendezDeliveryRoute,
  type RendezSessions,
} from "./RendezObserver.js";
import type { RendezTarget } from "./rendez-protocol.mjs";

const PROVIDER_HOST_SEND_MS = 30_000;

/**
 * Deliver to sessions YA owns directly; send others through the provider
 * runtime host, as the `rendez` helper does through session-turn.
 */
export function createRendezSessions(
  getAllProcesses: () => Process[],
): RendezSessions {
  return {
    async route(project, target): Promise<RendezDeliveryRoute> {
      const owned = getAllProcesses().find(
        (candidate) => candidate.sessionId === target.yaSessionId,
      );
      if (owned) {
        return {
          transport: "ya",
          profile: getProviderImageSizing(owned.provider, owned.resolvedModel)
            .profiles.sd,
          async send(id, text) {
            if (
              owned.projectPath !== project ||
              owned.execution.kind !== "local" ||
              owned.isProcessAlive !== true
            ) {
              return {
                accepted: false,
                diagnostics: "The target session is not live in this project",
              };
            }
            const result = owned.queueMessage(
              {
                uuid: id,
                text,
                metadata: {
                  origin: "rendezvous",
                  serverReceivedAt: new Date().toISOString(),
                },
              },
              { allowSteer: false },
            );
            return { accepted: result.success, diagnostics: result.error };
          },
        };
      }
      if (!isProviderRuntimeHostAvailable()) {
        return {
          transport: "provider-host",
          profile: RENDEZ_DEFAULT_PROFILE,
          async send() {
            return {
              accepted: false,
              diagnostics:
                "The target session is not owned by YA and no provider host is available",
            };
          },
        };
      }
      const runtime = (await getProviderHostInventory()).find(
        (row) =>
          row.harness === target.harness &&
          row.providerSessionId === target.providerSessionId,
      );
      return {
        transport: "provider-host",
        profile: runtime?.imagePreparationProfile ?? RENDEZ_DEFAULT_PROFILE,
        send: (id, text) => sendThroughProviderHost(target, id, text),
      };
    },
    turnStatus: (submissionId) =>
      getProviderHostSessionTurnStatus(submissionId),
  };
}

async function sendThroughProviderHost(
  target: RendezTarget,
  submissionId: string,
  text: string,
): Promise<{ accepted: boolean; receipt?: unknown; diagnostics?: string }> {
  const signal = AbortSignal.timeout(PROVIDER_HOST_SEND_MS);
  for await (const record of streamProviderHostSessionTurn(
    {
      submissionId,
      target: {
        harness: target.harness,
        providerSessionId: target.providerSessionId,
        yaSessionId: target.yaSessionId,
      },
      message: { text, metadata: { origin: "rendezvous" } },
      eventual: true,
      liveOnly: target.liveOnly === true,
      timeoutMs: PROVIDER_HOST_SEND_MS,
    },
    signal,
  )) {
    if (record.type === "accepted") return { accepted: true, receipt: record };
    if (record.type === "error" || record.type === "terminal") {
      return {
        accepted: false,
        receipt: record,
        diagnostics: record.error ?? record.outcome,
      };
    }
  }
  throw new Error("Provider host closed before accepting the upload");
}
