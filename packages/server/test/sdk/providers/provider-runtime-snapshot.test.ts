import { afterEach, describe, expect, it, vi } from "vitest";
import { configureProviderRuntime } from "../../../src/sdk/providers/index.js";
import { applyProviderRuntimeSnapshot } from "../../../src/sdk/providers/provider-runtime-snapshot.js";
import {
  gatewayEffortProbeCache,
  probeServiceEffort,
} from "../../../src/services/GatewayEffortProbe.js";

const CATALOG = { data: [{ id: "ds4" }] };
const ENDPOINT = "http://127.0.0.1:8001";

function readCatalogEffort(): Promise<unknown> {
  return probeServiceEffort({}, ENDPOINT, CATALOG);
}

describe("applyProviderRuntimeSnapshot", () => {
  afterEach(() => {
    gatewayEffortProbeCache.setEnabled(true);
    gatewayEffortProbeCache.forget();
    configureProviderRuntime({});
    vi.unstubAllGlobals();
  });

  it("asks no endpoint about effort when the launch turned detection off", async () => {
    const asked = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", asked);

    await applyProviderRuntimeSnapshot({
      gatewayServiceEffortDetection: false,
    });

    expect(await readCatalogEffort()).toBeUndefined();
    expect(asked).not.toHaveBeenCalled();
  });

  it("asks the endpoint when the launch left detection at its default", async () => {
    const asked = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                "1 validation error:\n  {'loc': 'body.reasoning_effort', " +
                "'msg': \"Input should be 'none', 'low', 'high'\"}",
            },
          }),
          { status: 400 },
        ),
    );
    vi.stubGlobal("fetch", asked);

    await applyProviderRuntimeSnapshot({});

    expect(await readCatalogEffort()).toEqual({
      levels: ["low", "high"],
      noThinking: true,
    });
    // Schema stage, then the chat-template stage that narrows it.
    expect(asked).toHaveBeenCalledTimes(2);
  });
});
