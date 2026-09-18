import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayService } from "@yep-anywhere/shared";
import { ClaudeGatewayProvider } from "../../../src/sdk/providers/claude-gateway.js";

class ExposedClaudeGatewayProvider extends ClaudeGatewayProvider {
  getLaunchSettings(model?: string) {
    return this.getSettings(model);
  }

  getLaunchToolOptions(model?: string) {
    return this.getDisallowedToolOptions(model);
  }
}

function service(overrides: Partial<GatewayService> = {}): GatewayService {
  return {
    id: "vllm",
    label: "",
    shortName: "",
    url: "http://127.0.0.1:8001",
    enabled: true,
    autoStop: false,
    autoStopAfterSeconds: 0,
    codexEnabled: false,
    codexWireApi: "responses",
    ...overrides,
  };
}

/** The exact rows a live vLLM 0.2.1 server returns for a served model. */
function vllmRow(id: string, maxModelLen = 252_000) {
  return {
    id,
    object: "model",
    owned_by: "vllm",
    root: "/local/graehl/models/DeepSeek-V4-Flash-0731",
    parent: null,
    max_model_len: maxModelLen,
    permission: [],
  };
}

function catalogResponse(
  data: unknown[],
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers });
}

describe("Claude Gateway services", () => {
  afterEach(async () => {
    await ClaudeGatewayProvider.configureGatewayServices({ services: [] });
    ClaudeGatewayProvider.forgetGatewayCatalog();
    vi.unstubAllGlobals();
  });

  it("reads a vLLM catalog and takes its window from max_model_len", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        catalogResponse([
          vllmRow("deepseek-v4-flash"),
          vllmRow("deepseek-v4-flash-0731"),
        ]),
      ),
    );
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [service()],
      defaultServiceId: "vllm",
    });
    const provider = new ExposedClaudeGatewayProvider({
      ensureReady: async () => null,
    });

    await expect(provider.getAvailableModels()).resolves.toMatchObject([
      { id: "deepseek-v4-flash", contextWindow: 252_000 },
      { id: "deepseek-v4-flash-0731", contextWindow: 252_000 },
    ]);
    expect(provider.getLaunchSettings("deepseek-v4-flash")?.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8001",
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "252000",
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "252000",
      AGENT_LAUNCH_BACKEND: "vllm",
    });
  });

  it("prefers declared sizes over whatever the endpoint advertises", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => catalogResponse([vllmRow("deepseek-v4-flash")])),
    );
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [
        service({ contextWindowTokens: 220_000, maxOutputTokens: 32_000 }),
      ],
      defaultServiceId: "vllm",
    });
    const provider = new ExposedClaudeGatewayProvider({
      ensureReady: async () => null,
    });

    await provider.getAvailableModels();
    expect(provider.getLaunchSettings("deepseek-v4-flash")?.env).toMatchObject({
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "220000",
      // The prompt window leaves room for the declared output size.
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "188000",
    });
  });

  it("truncates a long catalog to the configured limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        catalogResponse(
          Array.from({ length: 12 }, (_, index) => vllmRow(`model-${index}`)),
        ),
      ),
    );
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [service({ maxModels: 3 })],
      defaultServiceId: "vllm",
    });
    const provider = new ExposedClaudeGatewayProvider({
      ensureReady: async () => null,
    });

    await expect(
      provider.getAvailableModels().then((models) => models.map((m) => m.id)),
    ).resolves.toEqual(["model-0", "model-1", "model-2"]);
  });

  it("qualifies only the model ids two services both advertise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("http://127.0.0.1:8001")
          ? catalogResponse([vllmRow("shared-model"), vllmRow("only-vllm")])
          : catalogResponse([{ id: "shared-model" }, { id: "only-copilot" }]),
      ),
    );
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [
        service(),
        service({ id: "copilot", url: "http://127.0.0.1:4141" }),
      ],
      defaultServiceId: "vllm",
    });
    const provider = new ExposedClaudeGatewayProvider({
      ensureReady: async () => null,
    });

    const models = await provider.getAvailableModels();
    expect(models.map((model) => model.id).sort()).toEqual([
      "copilot::shared-model",
      "only-copilot",
      "only-vllm",
      "vllm::shared-model",
    ]);

    // Each qualified id launches against its own service, under the plain
    // model name that service knows.
    const vllmEnv = provider.getLaunchSettings("vllm::shared-model")?.env;
    expect(vllmEnv).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8001",
      ANTHROPIC_MODEL: "shared-model",
    });
    expect(
      provider.getLaunchSettings("copilot::shared-model")?.env,
    ).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4141",
      ANTHROPIC_MODEL: "shared-model",
    });
    expect(provider.getLaunchSettings("only-copilot")?.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4141",
      ANTHROPIC_MODEL: "only-copilot",
    });
  });

  it("lists models in the configured order, default entry included", async () => {
    // The picker shows this order, so it belongs to whoever arranged the
    // services editor. The default entry used to be hoisted to the front,
    // which buried a deliberately configured local endpoint behind whichever
    // service happened to be marked default.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("http://127.0.0.1:8001")
          ? catalogResponse([vllmRow("local-first"), vllmRow("local-second")])
          : catalogResponse([{ id: "hosted-first" }, { id: "hosted-second" }]),
      ),
    );
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [
        service(),
        service({ id: "copilot", url: "http://127.0.0.1:4141" }),
      ],
      // Marked default, and second in the list: it is read and may be started
      // first, but it does not jump the picker.
      defaultServiceId: "copilot",
    });
    const provider = new ExposedClaudeGatewayProvider({
      ensureReady: async () => null,
    });

    await expect(
      provider.getAvailableModels().then((models) => models.map((m) => m.id)),
    ).resolves.toEqual([
      "local-first",
      "local-second",
      "hosted-first",
      "hosted-second",
    ]);
  });

  it("starts only the default service while reading catalogs", async () => {
    const started: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => catalogResponse([vllmRow("model")])),
    );
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [
        service({ serviceCommand: "~/vllm/service-model" }),
        service({
          id: "other",
          url: "http://127.0.0.1:4141",
          serviceCommand: "copilot-api",
        }),
      ],
      defaultServiceId: "vllm",
    });
    const provider = new ExposedClaudeGatewayProvider({
      ensureReady: async (config) => {
        if (config.startCommand) started.push(config.startCommand);
        return null;
      },
    });

    await provider.getAvailableModels();
    expect(started).toEqual(["~/vllm/service-model"]);
  });

  it("starts a non-default service when one of its models is launched", async () => {
    const started: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("http://127.0.0.1:4141")
          ? catalogResponse([{ id: "only-copilot" }])
          : catalogResponse([vllmRow("only-vllm")]),
      ),
    );
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [
        service({ id: "copilot", url: "http://127.0.0.1:4141" }),
        service({ serviceCommand: "~/vllm/service-model" }),
      ],
      defaultServiceId: "copilot",
    });
    const provider = new ExposedClaudeGatewayProvider({
      ensureReady: async (config) => {
        if (config.startCommand) started.push(config.startCommand);
        return null;
      },
    });

    await provider.getAvailableModels();
    expect(started).toEqual([]);

    await provider
      .startSession({ model: "only-vllm" } as never)
      .catch(() => undefined);
    expect(started).toEqual(["~/vllm/service-model"]);
  });

  it("applies per-service overrides over the server-wide toggles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("http://127.0.0.1:8001")
          ? catalogResponse([vllmRow("local-model")])
          : catalogResponse([{ id: "hosted-model" }]),
      ),
    );
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [
        service({ disableAgent: false, disablePlanMode: false }),
        service({ id: "copilot", url: "http://127.0.0.1:4141" }),
      ],
      defaultServiceId: "copilot",
      disableAgent: true,
      disablePlanMode: true,
    });
    const provider = new ExposedClaudeGatewayProvider({
      ensureReady: async () => null,
    });
    await provider.getAvailableModels();

    expect(provider.getLaunchSettings("local-model")).not.toHaveProperty(
      "permissions",
    );
    expect(provider.getLaunchToolOptions("local-model")).toEqual({});
    expect(provider.getLaunchSettings("hosted-model")).toMatchObject({
      permissions: { deny: ["Agent"] },
    });
    expect(provider.getLaunchToolOptions("hosted-model")).toEqual({
      disallowedTools: ["EnterPlanMode", "ExitPlanMode"],
    });
  });

  it("keeps a service's last good catalog when its endpoint goes away", async () => {
    const responses = [
      catalogResponse([vllmRow("local-model")]),
      catalogResponse([{ id: "hosted-model" }]),
      new Response("unavailable", { status: 503 }),
      catalogResponse([{ id: "hosted-model" }]),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        // The effort probe is a second request per endpoint; only catalog
        // reads draw from this queue.
        if (!String(input).endsWith("/v1/models")) {
          return new Response("", { status: 404 });
        }
        const response = responses.shift();
        if (!response) throw new Error("Unexpected catalog request");
        return response;
      }),
    );
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [
        service(),
        service({ id: "copilot", url: "http://127.0.0.1:4141" }),
      ],
      defaultServiceId: "vllm",
    });
    const provider = new ExposedClaudeGatewayProvider({
      ensureReady: async () => null,
    });

    await provider.getAvailableModels();
    await expect(
      provider.getAvailableModels().then((models) => models.map((m) => m.id)),
    ).resolves.toEqual(["hosted-model"]);
    // The unreachable service's launch facts survive its failed refresh.
    expect(provider.getLaunchSettings("local-model")?.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8001",
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "252000",
    });
  });

  it("mirrors a single configured service through the legacy setters", () => {
    ClaudeGatewayProvider.setGatewayUrl("http://localhost:4141");
    ClaudeGatewayProvider.setGatewayStartCommand("copilot-api");
    expect(ClaudeGatewayProvider.getGatewayUrl()).toBe("http://localhost:4141");
    expect(ClaudeGatewayProvider.getServices()).toMatchObject([
      {
        id: "default",
        url: "http://localhost:4141",
        serviceCommand: "copilot-api",
      },
    ]);

    ClaudeGatewayProvider.setGatewayUrl(undefined);
    expect(ClaudeGatewayProvider.isConfigured()).toBe(false);
  });
});
