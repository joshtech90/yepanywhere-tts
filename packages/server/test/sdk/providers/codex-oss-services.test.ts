import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayService } from "@yep-anywhere/shared";
import { CodexOSSProvider } from "../../../src/sdk/providers/codex-oss.js";
import { gatewayEffortProbeCache } from "../../../src/services/GatewayEffortProbe.js";
import type { StartSessionOptions } from "../../../src/sdk/providers/types.js";

class ExposedCodexOSSProvider extends CodexOSSProvider {
  firstTurnArgs(
    model?: string,
    turn: Partial<StartSessionOptions> = {},
  ): string[] {
    return (
      this as unknown as {
        buildFirstTurnArgs(options: StartSessionOptions): string[];
      }
    ).buildFirstTurnArgs({ model, ...turn } as StartSessionOptions);
  }

  resumeTurnArgs(
    model: string | undefined,
    sessionId: string,
    turn: Partial<StartSessionOptions> = {},
  ): string[] {
    return (
      this as unknown as {
        buildResumeTurnArgs(
          options: StartSessionOptions,
          sessionId: string,
          prompt: string,
        ): string[];
      }
    ).buildResumeTurnArgs(
      { model, ...turn } as StartSessionOptions,
      sessionId,
      "go",
    );
  }
}

function service(overrides: Partial<GatewayService> = {}): GatewayService {
  return {
    id: "vllm",
    label: "DeepSeek V4 Flash",
    shortName: "vllm",
    url: "http://127.0.0.1:8001",
    enabled: true,
    autoStop: false,
    autoStopAfterSeconds: 0,
    codexEnabled: true,
    codexWireApi: "responses",
    ...overrides,
  };
}

/** The rows a live vLLM server returns, minus the fields Codex ignores. */
function vllmCatalog(ids: string[], maxModelLen = 252_000) {
  return new Response(
    JSON.stringify({
      data: ids.map((id) => ({
        id,
        object: "model",
        owned_by: "vllm",
        max_model_len: maxModelLen,
      })),
    }),
    { status: 200 },
  );
}

describe("CodexOSS gateway services", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // The probe cache is process-wide and keyed by endpoint, so one test's
    // answer about 127.0.0.1:8001 would otherwise stand in for the next's.
    gatewayEffortProbeCache.forget();
  });

  it("lists models from a configured endpoint instead of ollama", async () => {
    const fetchMock = vi.fn(async () =>
      vllmCatalog(["deepseek-v4-flash", "deepseek-v4-flash-0731"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);

    // The catalog states no effort vocabulary — no OpenAI-compatible row does —
    // so the levels come from what YA knows about the model family.
    const deepseekEffort = {
      supportsEffort: true,
      supportedEffortLevels: ["low", "high", "max"],
      supportedReasoningEfforts: [
        { reasoningEffort: "none" },
        { reasoningEffort: "low" },
        { reasoningEffort: "high" },
        { reasoningEffort: "max" },
      ],
      defaultEffortLevel: "high",
      defaultReasoningEffort: "high",
      supportsAdaptiveThinking: true,
    };
    await expect(provider.getAvailableModels()).resolves.toEqual([
      {
        id: "deepseek-v4-flash",
        name: "deepseek-v4-flash",
        contextWindow: 252_000,
        ...deepseekEffort,
      },
      {
        id: "deepseek-v4-flash-0731",
        name: "deepseek-v4-flash-0731",
        contextWindow: 252_000,
        ...deepseekEffort,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8001/v1/models",
      expect.anything(),
    );
  });

  it("reports itself usable with a configured endpoint and no ollama", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);

    await expect(provider.isAuthenticated()).resolves.toBe(true);
  });

  it("launches through a model provider override, not --oss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([
      service({ codexWireApi: "responses", contextWindowTokens: 252_000 }),
    ]);
    await provider.getAvailableModels();

    const args = provider.firstTurnArgs("deepseek-v4-flash");
    expect(args).toEqual([
      "exec",
      "-c",
      'model_providers.ya_vllm.name="DeepSeek V4 Flash"',
      "-c",
      'model_providers.ya_vllm.base_url="http://127.0.0.1:8001/v1"',
      "-c",
      'model_providers.ya_vllm.wire_api="responses"',
      "-c",
      'model_provider="ya_vllm"',
      "--json",
      "--model",
      "deepseek-v4-flash",
      "-s",
      "workspace-write",
    ]);
    expect(args).not.toContain("--oss");

    expect(provider.resumeTurnArgs("deepseek-v4-flash", "thread-1")).toEqual([
      "exec",
      "resume",
      "thread-1",
      "go",
      "-c",
      'model_providers.ya_vllm.name="DeepSeek V4 Flash"',
      "-c",
      'model_providers.ya_vllm.base_url="http://127.0.0.1:8001/v1"',
      "-c",
      'model_providers.ya_vllm.wire_api="responses"',
      "-c",
      'model_provider="ya_vllm"',
      "-c",
      'model="deepseek-v4-flash"',
    ]);
  });

  it("underscores a hyphenated service id into the provider key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service({ id: "local-vllm" })]);
    await provider.getAvailableModels();

    // The same key the export writes into ya-local-vllm.config.toml, which is
    // why both spell it through the shared `codexProviderKey`.
    expect(provider.firstTurnArgs("deepseek-v4-flash")).toContain(
      'model_provider="ya_local_vllm"',
    );
  });

  it("quotes a label and a model id that carry TOML metacharacters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(['deepseek\\v4 "flash"'])),
    );
    const provider = new ExposedCodexOSSProvider();
    // Both are values the user or the endpoint can supply: a label only has to
    // be trimmed and free of control characters, and a model id is whatever
    // the catalog row says.
    provider.setGatewayServices([service({ label: 'My "vLLM" \\ box' })]);
    await provider.getAvailableModels();

    expect(provider.firstTurnArgs('deepseek\\v4 "flash"')).toContain(
      'model_providers.ya_vllm.name="My \\"vLLM\\" \\\\ box"',
    );
    expect(
      provider.resumeTurnArgs('deepseek\\v4 "flash"', "thread-1"),
    ).toContain('model="deepseek\\\\v4 \\"flash\\""');
  });

  it("carries the selected effort to the endpoint, and nothing when unset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);
    await provider.getAvailableModels();

    expect(
      provider.firstTurnArgs("deepseek-v4-flash", { effort: "max" }),
    ).toContain('model_reasoning_effort="max"');
    expect(
      provider.resumeTurnArgs("deepseek-v4-flash", "thread-1", {
        effort: "low",
      }),
    ).toContain('model_reasoning_effort="low"');

    // A vanilla turn states no effort, so the endpoint keeps its own default.
    expect(provider.firstTurnArgs("deepseek-v4-flash").join(" ")).not.toContain(
      "model_reasoning_effort",
    );
  });

  it("snaps an unlisted effort down rather than asking for it", async () => {
    // DeepSeek V4 treats medium exactly as low, so it lists only the levels
    // that reach a distinct behavior; a session carrying medium from another
    // model must not end up buying more thinking than was asked for.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);
    await provider.getAvailableModels();

    expect(
      provider.firstTurnArgs("deepseek-v4-flash", { effort: "medium" }),
    ).toContain('model_reasoning_effort="low"');
    expect(
      provider.firstTurnArgs("deepseek-v4-flash", { effort: "xhigh" }),
    ).toContain('model_reasoning_effort="high"');
  });

  it("turns thinking off through the effort the wire does carry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);
    await provider.getAvailableModels();

    expect(
      provider.firstTurnArgs("deepseek-v4-flash", {
        thinking: { type: "disabled" },
      }),
    ).toContain('model_reasoning_effort="none"');
  });

  it("takes configured levels over the model family YA knows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([
      service({ effortLevels: ["low", "medium"], defaultEffortLevel: "low" }),
    ]);
    const [model] = await provider.getAvailableModels();

    expect(model?.supportedEffortLevels).toEqual(["low", "medium"]);
    expect(model?.defaultEffortLevel).toBe("low");
    expect(
      provider.firstTurnArgs("deepseek-v4-flash", { effort: "medium" }),
    ).toContain('model_reasoning_effort="medium"');
  });

  it("states no effort for a model nothing describes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["qwen3-coder-30b"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);
    const [model] = await provider.getAvailableModels();

    // Said explicitly rather than left unstated: the client offers a thinking
    // control for a model that says nothing, so silence would show one here.
    expect(model?.supportsEffort).toBe(false);
    expect(model?.supportsAdaptiveThinking).toBe(false);
    expect(model?.supportedEffortLevels).toBeUndefined();
    expect(
      provider.firstTurnArgs("qwen3-coder-30b", { effort: "high" }).join(" "),
    ).not.toContain("model_reasoning_effort");
  });

  it("offers the effort a copilot-style row advertises, as Claude Gateway does", async () => {
    // The asymmetry this covers: CodexOSS used to ignore a row's own claim, so
    // the same endpoint offered effort through one provider and not the other.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "gpt-5-codex",
              capabilities: { supports: { reasoning_effort: ["low", "high"] } },
            },
          ],
        }),
      ),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);
    const [model] = await provider.getAvailableModels();

    expect(model).toMatchObject({
      supportsEffort: true,
      supportedEffortLevels: ["low", "high"],
      supportsAdaptiveThinking: true,
    });
    expect(provider.firstTurnArgs("gpt-5-codex", { effort: "high" })).toContain(
      'model_reasoning_effort="high"',
    );
  });

  it("offers what the endpoint answered when nothing else describes the model", async () => {
    // A vLLM row for an unknown family states nothing, so without the probe
    // this model would carry no effort control at all.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/v1/models")
          ? vllmCatalog(["qwen3-coder-30b"])
          : new Response(
              JSON.stringify({
                error: {
                  message:
                    "{'loc': 'body.reasoning_effort', 'msg': \"Input should " +
                    "be 'none', 'low', 'high'\"}",
                },
              }),
              { status: 400 },
            ),
      ),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);
    const [model] = await provider.getAvailableModels();

    expect(model).toMatchObject({
      supportsEffort: true,
      supportedEffortLevels: ["low", "high"],
      supportsAdaptiveThinking: true,
      // The Responses API carries "none", so thinking-off is expressible.
      supportedReasoningEfforts: [
        { reasoningEffort: "none" },
        { reasoningEffort: "low" },
        { reasoningEffort: "high" },
      ],
    });
    // A launch must reach the same answer the catalog read published, which it
    // cannot re-derive from configuration alone.
    expect(
      provider.firstTurnArgs("qwen3-coder-30b", { effort: "high" }),
    ).toContain('model_reasoning_effort="high"');
  });

  it("does not ask an endpoint whose levels are already configured", async () => {
    const fetchMock = vi.fn(async () => vllmCatalog(["qwen3-coder-30b"]));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service({ effortLevels: ["low", "high"] })]);
    await provider.getAvailableModels();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/v1/chat/completions"),
      expect.anything(),
    );
  });

  it("still emits the legacy chat wire API when one is configured", async () => {
    // Current Codex refuses `chat`, but an older CLI needs it, so an explicit
    // choice is passed through rather than silently upgraded.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service({ codexWireApi: "chat" })]);
    await provider.getAvailableModels();

    expect(provider.firstTurnArgs("deepseek-v4-flash")).toContain(
      'model_providers.ya_vllm.wire_api="chat"',
    );
  });

  it("keeps the ollama path when no endpoint is configured", () => {
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([]);

    expect(provider.firstTurnArgs("qwen2.5-coder:32b-32k")).toEqual([
      "exec",
      "--oss",
      "--local-provider",
      "ollama",
      "--json",
      "--model",
      "qwen2.5-coder:32b-32k",
      "-s",
      "workspace-write",
    ]);
  });

  it("ignores an endpoint that did not opt into CodexOSS", async () => {
    const fetchMock = vi.fn(async () => vllmCatalog(["deepseek-v4-flash"]));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service({ codexEnabled: false })]);

    // No endpoint is available to it, so it falls back to asking Ollama.
    await provider.getAvailableModels();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("launches a collision-qualified model under its plain name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("http://127.0.0.1:8001")
          ? vllmCatalog(["shared-model"])
          : vllmCatalog(["shared-model"], 32_768),
      ),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([
      service(),
      service({ id: "second", label: "", url: "http://127.0.0.1:8002" }),
    ]);

    const models = await provider.getAvailableModels();
    expect(models.map((model) => model.id)).toEqual([
      "vllm::shared-model",
      "second::shared-model",
    ]);

    const args = provider.firstTurnArgs("second::shared-model");
    expect(args).toContain(
      'model_providers.ya_second.base_url="http://127.0.0.1:8002/v1"',
    );
    expect(args[args.indexOf("--model") + 1]).toBe("shared-model");
  });
});
