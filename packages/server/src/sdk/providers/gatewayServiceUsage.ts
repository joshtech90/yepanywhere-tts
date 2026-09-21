/**
 * How many live sessions each configured gateway service is serving.
 *
 * Auto-stop asks a service to shut down once nothing is using it, so "in use"
 * has to mean a process that exists right now, not a recent launch. Sessions
 * are attributed by the model they were launched with, which is the same
 * routing the launch environment used. Both providers that reach these
 * endpoints count: Claude Gateway speaks the Anthropic wire to them and
 * CodexOSS the Responses API, and either one dies if the service stops.
 */

import { ClaudeGatewayProvider } from "./claude-gateway.js";
import { codexOSSProvider } from "./codex-oss.js";
import type { ProcessInfo } from "../../supervisor/types.js";
import type { Supervisor } from "../../supervisor/Supervisor.js";

export function gatewayServiceUsage(
  supervisor: Pick<Supervisor, "getProcessInfoList">,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const service of ClaudeGatewayProvider.getServices()) {
    counts.set(service.id, 0);
  }

  for (const info of supervisor.getProcessInfoList()) {
    const serviceId = serviceForProcess(info);
    if (!serviceId) continue;
    counts.set(serviceId, (counts.get(serviceId) ?? 0) + 1);
  }
  return counts;
}

/** The service a live process is holding open, if it is holding one. */
function serviceForProcess(info: ProcessInfo): string | undefined {
  const model = info.requestedModel ?? info.model;
  if (info.provider === "claude-gateway") {
    // A gateway session whose model no longer resolves still occupies the
    // default service; counting it there is the conservative choice, since the
    // cost of a missed stop is an idle server and the cost of a wrong stop is
    // a killed session.
    return (
      ClaudeGatewayProvider.resolveServiceForModel(model)?.serviceId ??
      ClaudeGatewayProvider.defaultService()?.id
    );
  }
  if (info.provider === "codex-oss") {
    // No default-service fallback here, unlike above: CodexOSS also launches
    // against Ollama, so an unresolved model names a session that never opened
    // a service rather than one whose service was forgotten.
    return codexOSSProvider.resolveServiceForModel(model)?.serviceId;
  }
  return undefined;
}
