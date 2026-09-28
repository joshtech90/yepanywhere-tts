import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GatewayEffortProbeCache,
  detectEndpointEffort,
  gatewayEffortProbeCache,
  probeServiceEffort,
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

/**
 * Requests one ask costs.
 *
 * Asking is two stages: the schema stage that provokes the accepted literals,
 * and the chat-template stage that checks whether the model behind the endpoint
 * narrows them. Asking about one model of an endpoint that answers the first
 * stage runs both.
 */
const FETCHES_PER_ASK = 2;

/** vLLM's chat-template rejection of an effort its request schema accepts. */
function templateRejecting(): Response {
  return new Response(
    JSON.stringify({
      error: {
        message:
          "Unexpected reasoning effort high. Supported types are " +
          "xhigh (default), medium, and low.",
        type: "BadRequestError",
      },
    }),
    { status: 400 },
  );
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
    expect(fetchImpl).toHaveBeenCalledTimes(FETCHES_PER_ASK);
  });

  it("narrows the schema's literals to what the chat template takes", async () => {
    // vLLM validates the field against a seven-value literal, then hands the
    // request to a chat template that knows three. Only the template's answer
    // describes the model the user is about to run, and it names the default.
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        reasoning_effort: string;
      };
      return body.reasoning_effort === "ya-capability-probe"
        ? rejecting()
        : templateRejecting();
    });
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
    );

    expect(await cache.probe("http://127.0.0.1:8001", "m")).toEqual({
      levels: ["low", "medium", "xhigh"],
      defaultLevel: "xhigh",
      // The template did not list "none", so thinking cannot be switched off
      // however permissive the request schema was.
      noThinking: false,
    });
    // The second stage asks with the highest level the schema listed, which is
    // the one a narrowing template is most likely to reject for free.
    const second = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(second[1].body))).toMatchObject({
      reasoning_effort: "high",
      max_tokens: 1,
    });
  });

  it("keeps the schema's answer when the template accepts its top level", async () => {
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        reasoning_effort: string;
      };
      return body.reasoning_effort === "ya-capability-probe"
        ? rejecting()
        : new Response("{}", { status: 200 });
    });
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
    );

    expect(await cache.probe("http://host:1", "m")).toEqual({
      levels: ["low", "high"],
      noThinking: true,
    });
  });

  it("keeps the schema's answer when asking the template fails", async () => {
    // The likeliest failure: the template accepted the top level, and its
    // one-token completion is still queued behind real work when the probe's
    // deadline expires. What the schema stage learned still stands, and is not
    // paid for again on the next catalog read.
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        reasoning_effort: string;
      };
      if (body.reasoning_effort === "ya-capability-probe") return rejecting();
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
    );

    const schemaAnswer = { levels: ["low", "high"], noThinking: true };
    expect(await cache.probe("http://host:1", "m")).toEqual(schemaAnswer);
    expect(await cache.probe("http://host:1", "m")).toEqual(schemaAnswer);
    expect(fetchImpl).toHaveBeenCalledTimes(FETCHES_PER_ASK);
  });

  it("asks each model's chat template, and the endpoint's schema once", async () => {
    // One vLLM serving two models: the schema is the server's, the template is
    // each model's own. The narrow model's answer must not become the other's.
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        reasoning_effort: string;
      };
      if (body.reasoning_effort === "ya-capability-probe") return rejecting();
      return body.model === "narrow"
        ? templateRejecting()
        : new Response("{}", { status: 200 });
    });
    const cache = new GatewayEffortProbeCache(
      fetchImpl as unknown as typeof fetch,
    );

    expect(await cache.probe("http://host:1", "narrow")).toEqual({
      levels: ["low", "medium", "xhigh"],
      defaultLevel: "xhigh",
      noThinking: false,
    });
    expect(await cache.probe("http://host:1", "wide")).toEqual({
      levels: ["low", "high"],
      noThinking: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
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
    expect(fetchImpl).toHaveBeenCalledTimes(2 * FETCHES_PER_ASK);
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
    expect(fetchImpl).toHaveBeenCalledTimes(2 * FETCHES_PER_ASK);
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

describe("probeServiceEffort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    gatewayEffortProbeCache.forget();
  });

  it("gives each listed model its own answer, asking templates only where they decide", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          reasoning_effort: string;
        };
        if (body.reasoning_effort === "ya-capability-probe") return rejecting();
        asked.push(body.model);
        return body.model === "narrow"
          ? templateRejecting()
          : new Response("{}", { status: 200 });
      }),
    );

    const answers = await probeServiceEffort(
      {},
      "http://127.0.0.1:8001",
      {
        data: [
          { id: "narrow" },
          { id: "wide" },
          // A family YA knows and a row stating its own levels take their
          // levels from those, so no template answer could change them.
          { id: "deepseek-v4-flash" },
          {
            id: "advertised",
            capabilities: { supports: { reasoning_effort: ["low"] } },
          },
          { id: "unlisted" },
        ],
      },
      (_row, id) => id !== "unlisted",
    );

    expect(asked.sort()).toEqual(["narrow", "wide"]);
    expect(answers.get("narrow")?.levels).toEqual(["low", "medium", "xhigh"]);
    expect(answers.get("wide")?.levels).toEqual(["low", "high"]);
    // The endpoint's schema answer still says whether thinking can stop.
    expect(answers.get("deepseek-v4-flash")?.noThinking).toBe(true);
    expect(answers.get("advertised")?.noThinking).toBe(true);
    expect(answers.has("unlisted")).toBe(false);
  });

  it("asks nothing for an entry that states its own levels", async () => {
    const fetchImpl = vi.fn(async () => rejecting());
    vi.stubGlobal("fetch", fetchImpl);

    const answers = await probeServiceEffort(
      { effortLevels: ["high"] },
      "http://127.0.0.1:8001",
      { data: [{ id: "m" }] },
    );

    expect(answers.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
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
