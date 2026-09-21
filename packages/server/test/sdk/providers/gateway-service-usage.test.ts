import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayService, UrlProjectId } from "@yep-anywhere/shared";
import {
  ClaudeGatewayProvider,
  noteGatewayServiceUsage,
} from "../../../src/sdk/providers/claude-gateway.js";
import { codexOSSProvider } from "../../../src/sdk/providers/codex-oss.js";
import { gatewayServiceUsage } from "../../../src/sdk/providers/gatewayServiceUsage.js";
import type { Supervisor } from "../../../src/supervisor/Supervisor.js";
import type { ProcessInfo } from "../../../src/supervisor/types.js";

function service(overrides: Partial<GatewayService> = {}): GatewayService {
  return {
    id: "vllm",
    label: "DeepSeek V4 Flash",
    shortName: "vllm",
    url: "http://127.0.0.1:8001",
    enabled: true,
    codexEnabled: true,
    codexWireApi: "responses",
    // Stating the levels keeps the catalog read from probing the endpoint for
    // them; this suite is about attribution, not effort.
    effortLevels: ["low", "high"],
    autoStop: false,
    autoStopAfterSeconds: 0,
    ...overrides,
  };
}

/** The rows a live vLLM server returns, minus the fields Codex ignores. */
function vllmCatalog(ids: string[]): Response {
  return new Response(
    JSON.stringify({
      data: ids.map((id) => ({ id, object: "model", owned_by: "vllm" })),
    }),
    { status: 200 },
  );
}

let processCount = 0;

function liveProcess(
  provider: ProcessInfo["provider"],
  requestedModel: string,
): ProcessInfo {
  processCount += 1;
  return {
    id: `process-${processCount}`,
    sessionId: `session-${processCount}`,
    projectId: "project" as UrlProjectId,
    projectPath: "/tmp/project",
    projectName: "project",
    sessionTitle: null,
    state: "idle",
    startedAt: "2026-09-18T00:00:00.000Z",
    queueDepth: 0,
    provider,
    requestedModel,
  };
}

function supervisorWith(
  processes: ProcessInfo[],
): Pick<Supervisor, "getProcessInfoList"> {
  return { getProcessInfoList: () => processes };
}

/** Let the CodexOSS catalog read learn which endpoint serves which model. */
async function readCodexCatalog(services: GatewayService[]): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
  );
  codexOSSProvider.setGatewayServices(services);
  await codexOSSProvider.getAvailableModels();
}

describe("gateway service usage", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await ClaudeGatewayProvider.configureGatewayServices({ services: [] });
    ClaudeGatewayProvider.forgetGatewayCatalog();
    codexOSSProvider.setGatewayServices([]);
    vi.unstubAllGlobals();
  });

  it("counts a CodexOSS session against the endpoint serving its model", async () => {
    const services = [service()];
    await ClaudeGatewayProvider.configureGatewayServices({
      services,
      defaultServiceId: "vllm",
    });
    await readCodexCatalog(services);

    const counts = gatewayServiceUsage(
      supervisorWith([
        liveProcess("claude-gateway", "deepseek-v4-flash"),
        liveProcess("codex-oss", "deepseek-v4-flash"),
      ]),
    );

    expect(counts.get("vllm")).toBe(2);
  });

  it("leaves a local CodexOSS session out of every endpoint's count", async () => {
    const services = [service()];
    await ClaudeGatewayProvider.configureGatewayServices({
      services,
      defaultServiceId: "vllm",
    });
    await readCodexCatalog(services);

    // Ollama serves this one, so the session holds no endpoint open and must
    // not keep one running. This is where CodexOSS differs from Claude
    // Gateway, whose unresolved models fall back to the default service.
    const counts = gatewayServiceUsage(
      supervisorWith([liveProcess("codex-oss", "llama3.2")]),
    );

    expect(counts.get("vllm")).toBe(0);
  });

  it("cancels a pending auto-stop when a CodexOSS session appears", async () => {
    const services = [
      service({
        serviceCommand: "vllm-serve start",
        autoStop: true,
        autoStopAfterSeconds: 300,
      }),
    ];
    await ClaudeGatewayProvider.configureGatewayServices({
      services,
      defaultServiceId: "vllm",
    });
    await readCodexCatalog(services);

    vi.useFakeTimers();
    noteGatewayServiceUsage(new Map([["vllm", 0]]));
    expect(vi.getTimerCount()).toBe(1);

    noteGatewayServiceUsage(
      gatewayServiceUsage(
        supervisorWith([liveProcess("codex-oss", "deepseek-v4-flash")]),
      ),
    );

    // The countdown is gone rather than merely deferred. Asserted by its
    // absence instead of by running the clock out: a fired timer would spawn
    // the configured stop command.
    expect(vi.getTimerCount()).toBe(0);
  });
});
