import { describe, expect, it } from "vitest";
import { parseGatewayServices } from "@yep-anywhere/shared";
import { reconcileGatewaySettings } from "../../src/services/gatewayServiceSettings.js";

function service(overrides: Record<string, unknown> = {}) {
  return {
    id: "vllm",
    url: "http://127.0.0.1:8001",
    ...overrides,
  };
}

describe("parseGatewayServices", () => {
  it("fills defaults for an entry that states only an id and a URL", () => {
    expect(parseGatewayServices([service()])).toEqual([
      {
        id: "vllm",
        label: "",
        shortName: "",
        url: "http://127.0.0.1:8001",
        enabled: true,
        autoStop: false,
        autoStopAfterSeconds: 300,
        codexEnabled: false,
        codexWireApi: "responses",
      },
    ]);
  });

  it("keeps declared windows, overrides, and Codex opt-in", () => {
    const parsed = parseGatewayServices([
      service({
        label: "DeepSeek V4 Flash",
        shortName: "vllm",
        serviceCommand: "~/vllm/service-model",
        autoStop: true,
        autoStopAfterSeconds: 60,
        disableAgent: false,
        disablePlanMode: true,
        contextWindowTokens: 252_000,
        maxOutputTokens: 32_000,
        codexEnabled: true,
        codexWireApi: "responses",
      }),
    ]);
    expect(parsed?.[0]).toMatchObject({
      label: "DeepSeek V4 Flash",
      shortName: "vllm",
      serviceCommand: "~/vllm/service-model",
      autoStop: true,
      autoStopAfterSeconds: 60,
      disableAgent: false,
      disablePlanMode: true,
      contextWindowTokens: 252_000,
      maxOutputTokens: 32_000,
      codexEnabled: true,
      codexWireApi: "responses",
    });
  });

  it.each([
    ["an id that is not a slug", service({ id: "Not A Slug" })],
    ["a duplicate id", service()],
    ["a URL with credentials", service({ url: "http://a:b@127.0.0.1:8001" })],
    ["a URL with a query", service({ url: "http://127.0.0.1:8001?x=1" })],
    ["a non-http scheme", service({ url: "ftp://127.0.0.1:8001" })],
    ["a zero context window", service({ contextWindowTokens: 0 })],
    ["a fractional window", service({ contextWindowTokens: 1.5 })],
    ["an unknown wire API", service({ codexWireApi: "grpc" })],
    ["a negative idle delay", service({ autoStopAfterSeconds: -1 })],
  ])("rejects the whole list for %s", (_label, entry) => {
    // Duplicate-id coverage needs a preceding entry with the same id.
    const list =
      entry.id === "vllm" && "id" in entry && Object.keys(entry).length === 2
        ? [service(), entry]
        : [entry];
    expect(parseGatewayServices(list)).toBeNull();
  });
});

describe("reconcileGatewaySettings", () => {
  it("migrates legacy gateway settings into a default entry", () => {
    const result = reconcileGatewaySettings([], undefined, {
      claudeGatewayUrl: "http://localhost:4141",
      claudeGatewayStartCommand: "copilot-api start",
    });
    expect(result.services).toEqual([
      {
        id: "default",
        label: "",
        shortName: "",
        url: "http://localhost:4141",
        enabled: true,
        serviceCommand: "copilot-api start",
        autoStop: false,
        autoStopAfterSeconds: 300,
        codexEnabled: false,
        codexWireApi: "responses",
      },
    ]);
    expect(result.defaultServiceId).toBe("default");
    expect(result.claudeGatewayUrl).toBe("http://localhost:4141");
  });

  it("migrates to the entry a services list would have held", () => {
    const result = reconcileGatewaySettings([], undefined, {
      claudeGatewayUrl: "http://localhost:4141",
      claudeGatewayStartCommand: "copilot-api start",
    });
    expect(result.services).toEqual(
      parseGatewayServices([
        {
          id: "default",
          url: "http://localhost:4141",
          serviceCommand: "copilot-api start",
        },
      ]),
    );
  });

  it("keeps a start command that has no URL yet", () => {
    const result = reconcileGatewaySettings([], undefined, {
      claudeGatewayStartCommand: "copilot-api start",
    });
    expect(result.services).toEqual([]);
    expect(result.claudeGatewayStartCommand).toBe("copilot-api start");
  });

  it("mirrors the default entry back into the legacy keys", () => {
    const services = parseGatewayServices([
      service({ id: "copilot", url: "http://localhost:4141" }),
      service({ id: "vllm", serviceCommand: "~/vllm/service-model" }),
    ])!;
    const result = reconcileGatewaySettings(services, "vllm", {});
    expect(result.claudeGatewayUrl).toBe("http://127.0.0.1:8001");
    expect(result.claudeGatewayStartCommand).toBe("~/vllm/service-model");
    expect(result.defaultServiceId).toBe("vllm");
  });

  it("adopts an older client's gateway edit into the default entry", () => {
    const services = parseGatewayServices([
      service({ id: "copilot", url: "http://localhost:4141" }),
      service({ id: "vllm" }),
    ])!;
    const result = reconcileGatewaySettings(services, "copilot", {
      claudeGatewayUrl: "http://localhost:4200",
    });
    expect(result.services.find((entry) => entry.id === "copilot")?.url).toBe(
      "http://localhost:4200",
    );
    // The entry an old client cannot see is left exactly as configured.
    expect(result.services.find((entry) => entry.id === "vllm")?.url).toBe(
      "http://127.0.0.1:8001",
    );
    expect(result.claudeGatewayUrl).toBe("http://localhost:4200");
  });

  it("falls back to the first entry when the named default is gone", () => {
    const services = parseGatewayServices([service({ id: "vllm" })])!;
    const result = reconcileGatewaySettings(services, "removed", {});
    expect(result.defaultServiceId).toBe("vllm");
  });
});
