/**
 * How many live sessions each configured gateway service is serving.
 *
 * Auto-stop asks a service to shut down once nothing is using it, so "in use"
 * has to mean a process that exists right now, not a recent launch. Sessions
 * are attributed by the model they were launched with, which is the same
 * routing the launch environment used.
 */

import { ClaudeGatewayProvider } from "./claude-gateway.js";
import type { Supervisor } from "../../supervisor/Supervisor.js";

export function gatewayServiceUsage(
  supervisor: Pick<Supervisor, "getProcessInfoList">,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const service of ClaudeGatewayProvider.getServices()) {
    counts.set(service.id, 0);
  }

  for (const info of supervisor.getProcessInfoList()) {
    if (info.provider !== "claude-gateway") continue;
    const route = ClaudeGatewayProvider.resolveServiceForModel(
      info.requestedModel ?? info.model,
    );
    // A gateway session whose model no longer resolves still occupies the
    // default service; counting it there is the conservative choice, since the
    // cost of a missed stop is an idle server and the cost of a wrong stop is
    // a killed session.
    const serviceId =
      route?.serviceId ?? ClaudeGatewayProvider.defaultService()?.id;
    if (!serviceId) continue;
    counts.set(serviceId, (counts.get(serviceId) ?? 0) + 1);
  }
  return counts;
}
