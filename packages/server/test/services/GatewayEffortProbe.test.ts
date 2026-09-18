import { describe, expect, it, vi } from "vitest";
import {
  GatewayEffortProbeCache,
  detectEndpointEffort,
} from "../../src/services/GatewayEffortProbe.js";

const REJECTION = JSON.stringify({
  error: {
    message:
      "1 validation error:\n  {'loc': 'body.reasoning_effort', 'msg': " +
      "\"Input should be 'none', 'low', 'high'\"}",
  },
});

function rejecting(): Response {
  return new Response(REJECTION, { status: 400 });
}

describe("GatewayEffortProbeCache", () => {
  it("reports the levels the endpoint listed", async () => {
    const fetchImpl = vi.fn(async () => rejecting());
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
    );

    expect(await cache.probe("http://127.0.0.1:8001", "m")).toEqual({
      levels: ["low", "high"],
      noThinking: true,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:8001/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "m",
      max_tokens: 1,
    });
  });

  it("asks one endpoint once, however many catalog reads want the answer", async () => {
    const fetchImpl = vi.fn(async () => rejecting());
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
    );

    // Concurrent reads share the in-flight request; a later read reads cache.
    await Promise.all([
      cache.probe("http://127.0.0.1:8001", "m"),
      cache.probe("http://127.0.0.1:8001/", "m"),
    ]);
    await cache.probe("http://127.0.0.1:8001", "m");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks again once a cached answer has aged out", async () => {
    const fetchImpl = vi.fn(async () => rejecting());
    let now = 0;
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
      () => now,
    );

    await cache.probe("http://host:1", "m");
    now = 31 * 60 * 1000;
    await cache.probe("http://host:1", "m");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches a silence briefly, so a down endpoint is retried sooner", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    let now = 0;
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
      () => now,
    );

    expect(await cache.probe("http://host:1", "m")).toBeUndefined();
    now = 30_000;
    await cache.probe("http://host:1", "m");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 61_000;
    await cache.probe("http://host:1", "m");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("asks nothing at all while detection is switched off", async () => {
    const fetchImpl = vi.fn(async () => rejecting());
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
    );

    cache.setEnabled(false);
    expect(await cache.probe("http://host:1", "m")).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops what it knew when detection is switched back on", async () => {
    const fetchImpl = vi.fn(async () => rejecting());
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
    );

    await cache.probe("http://host:1", "m");
    cache.setEnabled(false);
    cache.setEnabled(true);
    await cache.probe("http://host:1", "m");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("learns nothing from an endpoint that accepted the unrecognized value", async () => {
    // A server that validates nothing answers 200; that is not a statement
    // that it accepts every level, so nothing is reported.
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
    );

    expect(await cache.probe("http://host:1", "m")).toBeUndefined();
  });
});

describe("detectEndpointEffort", () => {
  it("reads the catalog for a model id, then asks about effort", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "ds4" }] }));
      }
      return rejecting();
    });

    expect(
      await detectEndpointEffort(
        "http://127.0.0.1:8001/",
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual({
      ok: true,
      modelId: "ds4",
      probe: { levels: ["low", "high"], noThinking: true },
    });
  });

  it("distinguishes an endpoint that is down from one that says nothing", async () => {
    const down = vi.fn(async () => new Response("", { status: 502 }));
    expect(
      await detectEndpointEffort(
        "http://host:1",
        down as unknown as typeof fetch,
      ),
    ).toEqual({ ok: false, reason: "unreachable" });

    const empty = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    expect(
      await detectEndpointEffort(
        "http://host:1",
        empty as unknown as typeof fetch,
      ),
    ).toEqual({ ok: false, reason: "no-models" });

    const quiet = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/v1/models")
        ? new Response(JSON.stringify({ data: [{ id: "m" }] }))
        : new Response("no such parameter", { status: 400 }),
    );
    expect(
      await detectEndpointEffort(
        "http://host:1",
        quiet as unknown as typeof fetch,
      ),
    ).toEqual({ ok: false, reason: "undescribed" });
  });
});
