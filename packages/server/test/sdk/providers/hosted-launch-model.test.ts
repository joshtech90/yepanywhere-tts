import { afterEach, describe, expect, it, vi } from "vitest";

const { native, origin } = vi.hoisted(() => ({
  native: { enabled: vi.fn(async () => false) },
  origin: Object.freeze({ launch: "fixture-origin" }),
}));
vi.mock("../../../src/desktop/machine-control.js", () => ({
  nativeMachineControl: () => native,
  isDesktopControlOrigin: (value: unknown) => value === origin,
}));

const startHostedProviderSession = vi.fn(async () => ({}));

vi.mock("../../../src/sdk/providers/provider-runtime-host.js", () => ({
  isProviderRuntimeHostAvailable: () => true,
  retainProviderRuntimeProcessGroup: vi.fn(),
  startHostedProviderSession,
}));

const { claudeProvider, codexOSSProvider, getProvider } = await import(
  "../../../src/sdk/providers/index.js"
);

describe("hosted provider launch model", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    startHostedProviderSession.mockClear();
    native.enabled.mockReset().mockResolvedValue(false);
  });

  it("hands the host the concrete model an alias resolves to", async () => {
    vi.spyOn(claudeProvider, "resolveLaunchModel").mockImplementation(
      (model) => (model === "opus" ? "claude-opus-5-5" : undefined),
    );

    await getProvider("claude")?.startSession({ cwd: "/tmp", model: "opus" });

    expect(startHostedProviderSession).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({
        model: "opus",
        launchModel: "claude-opus-5-5",
      }),
      expect.anything(),
    );
  });

  it("hands the host the endpoint this server resolved a CodexOSS model to", async () => {
    vi.spyOn(codexOSSProvider, "resolveLaunchGatewayRoute").mockImplementation(
      async (model) =>
        model === "deepseek-v4-flash"
          ? { serviceId: "vllm", modelId: "deepseek-v4-flash" }
          : null,
    );

    await getProvider("codex-oss")?.startSession({
      cwd: "/tmp",
      model: "deepseek-v4-flash",
    });
    await getProvider("codex-oss")?.startSession({
      cwd: "/tmp",
      model: "llama3.2",
    });

    // The worker reads no catalog, so both answers travel with the launch,
    // including the one binding a model to the local provider.
    expect(startHostedProviderSession).toHaveBeenNthCalledWith(
      1,
      "codex-oss",
      expect.objectContaining({
        gatewayRoute: { serviceId: "vllm", modelId: "deepseek-v4-flash" },
      }),
      expect.anything(),
    );
    expect(startHostedProviderSession).toHaveBeenNthCalledWith(
      2,
      "codex-oss",
      expect.objectContaining({ gatewayRoute: null }),
      expect.anything(),
    );
  });
  it("preserves detached advertisement when operator native trust is off", async () => {
    await getProvider("claude")?.startSession({
      cwd: "/tmp",
      machineControl: true,
      desktopControlOrigin: origin,
    });
    expect(startHostedProviderSession).toHaveBeenCalledOnce();
    expect(native.enabled).toHaveBeenCalledOnce();
  });

  it("refuses unqualified detached ownership only when native trust is selected", async () => {
    native.enabled.mockResolvedValue(true);
    await expect(
      getProvider("claude")?.startSession({
        cwd: "/tmp",
        machineControl: true,
        desktopControlOrigin: origin,
      }),
    ).rejects.toThrow("detached provider hosting is unsupported");
    expect(startHostedProviderSession).not.toHaveBeenCalled();
  });

  it("does not turn a failed native handoff into detached ambient access", async () => {
    native.enabled.mockRejectedValue(new Error("Native channel closed"));
    await expect(
      getProvider("claude")?.startSession({
        cwd: "/tmp",
        machineControl: true,
        desktopControlOrigin: origin,
      }),
    ).rejects.toThrow("Native channel closed");
    expect(startHostedProviderSession).not.toHaveBeenCalled();
  });
});
