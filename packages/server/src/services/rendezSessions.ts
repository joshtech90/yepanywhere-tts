import type { RendezDelivery } from "@yep-anywhere/shared";
import type { UserMessage } from "../sdk/types.js";
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
  type RendezDraftTarget,
  type RendezSessions,
} from "./RendezObserver.js";
import type { RendezTarget } from "./rendez-protocol.mjs";
import type { RendezDraftDelivery } from "./RendezDraftDelivery.js";

const PROVIDER_HOST_SEND_MS = 30_000;

/**
 * Deliver to sessions YA owns directly; send others through the provider
 * runtime host, as the `rendez` helper does through session-turn.
 */
export function createRendezSessions(
  getAllProcesses: () => Process[],
  getDelivery: () => RendezDelivery | undefined,
  draftRoute?: (
    project: string,
    target: RendezDraftTarget,
  ) => RendezDeliveryRoute,
  drafts?: RendezDraftDelivery,
): RendezSessions {
  return {
    async route(project, target): Promise<RendezDeliveryRoute> {
      if ("draft" in target) {
        if (!draftRoute)
          throw new Error("Rendez draft delivery is unavailable");
        return draftRoute(project, target);
      }
      const owned = getAllProcesses().find(
        (candidate) => candidate.sessionId === target.yaSessionId,
      );
      if (owned) {
        const live = () =>
          owned.projectPath === project && owned.isProcessAlive === true;
        const route: RendezDeliveryRoute = {
          transport: "ya",
          profile: getProviderImageSizing(owned.provider, owned.resolvedModel)
            .profiles.sd,
          async send(id, text) {
            if (!live()) {
              return {
                accepted: false,
                diagnostics: "The target session is not live in this project",
              };
            }
            // An upload is the user's own input, so it takes a typed send's
            // path and presentation: a steer into the running turn, or a
            // queued chip. Held to turn end while the user steers, it would
            // land after the commentary sent about it.
            const delivery = getDelivery() ?? "auto";
            const action =
              delivery === "auto"
                ? (owned.lastBusySendAction ?? "steer")
                : delivery;
            const message: UserMessage = {
              uuid: id,
              // Identifies the queued chip and the delivered echo.
              tempId: id,
              text,
              metadata: {
                origin: "rendezvous",
                serverReceivedAt: new Date().toISOString(),
                deliveryIntent: action === "steer" ? "steer" : "deferred",
              },
            };
            const result =
              action === "steer"
                ? owned.queueMessage(message)
                : owned.deferMessage(message, { promoteIfReady: true });
            return { accepted: result.success, diagnostics: result.error };
          },
        };
        if (!drafts || !target.yaSessionId) return route;
        const sessionId = target.yaSessionId;
        return {
          ...route,
          send: (id, text, record) =>
            live()
              ? drafts.stage(sessionId, id, text, record, route.send)
              : route.send(id, text, record),
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
      const route: RendezDeliveryRoute = {
        transport: "provider-host",
        profile: runtime?.imagePreparationProfile ?? RENDEZ_DEFAULT_PROFILE,
        send: (id, text) => sendThroughProviderHost(target, id, text),
      };
      if (
        !drafts ||
        !target.yaSessionId ||
        !runtime ||
        runtime.projectPath !== project ||
        !runtime.acceptsSessionTurns ||
        runtime.state === "closing"
      )
        return route;
      const sessionId = target.yaSessionId;
      return {
        ...route,
        send: (id, text, record) =>
          drafts.stage(sessionId, id, text, record, route.send),
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
