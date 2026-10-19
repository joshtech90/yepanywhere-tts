import { afterEach, expect, it, vi } from "vitest";
import { NativeSourceTransport } from "../NativeSourceTransport";
import { NativeTransportFixture } from "./nativeTransportFixture";

const sources: NativeSourceTransport[] = [];
async function setup(binary = true) {
  const host = new NativeTransportFixture(binary, "CONNECTED", true);
  const source = new NativeSourceTransport(host.channel);
  sources.push(source);
  await source.ready;
  return { host, source };
}
afterEach(() => {
  for (const source of sources.splice(0)) source.dispose();
  vi.useRealTimers();
});

it.each([true, false])(
  "pulls exact byte chunks across the credited bridge (binary=%s)",
  async (binary) => {
    const { host, source } = await setup(binary);
    let reads = 0;
    host.handler = (command) =>
      command.method === "responseStart"
        ? {
            streaming: true,
            responseId: command.id,
            status: 206,
            length: 131072,
            headers: {
              "content-type": "video/mp4",
              "content-range": "bytes 9-131080/999999",
            },
          }
        : ++reads === 1
          ? new Uint8Array(131072).fill(179)
          : { done: true };
    const response = await source.fetchStream("/movie", {
      headers: { Range: "bytes=9-131080" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 9-131080/999999");
    expect(host.commands).toHaveLength(1);
    expect(host.commands[0]?.params).toMatchObject({
      headers: { range: "bytes=9-131080" },
    });
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(
      new Uint8Array(131072).fill(179),
    );
    expect(host.commands).toHaveLength(2);
    expect((await reader.read()).done).toBe(true);
    expect(reads).toBe(2);
  },
);

it.each(["reader", "signal", "suspend", "dispose"])(
  "cancels a blocked producer on %s and ignores its late bytes",
  async (mode) => {
    const { host, source } = await setup();
    let complete!: (value: Uint8Array) => void;
    host.handler = (command) => {
      if (command.method === "responseStart")
        return { streaming: true, responseId: command.id, status: 200 };
      if (command.method === "responseRead")
        return new Promise<Uint8Array>((resolve) => {
          complete = resolve;
        });
      return { status: 200, body: { healthy: true } };
    };
    const abort = new AbortController();
    const response = await source.fetchStream("/movie", {
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    const read = reader.read();
    const observed = read.catch(() => undefined);
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    if (mode === "reader") await reader.cancel();
    else if (mode === "signal") abort.abort();
    else if (mode === "suspend")
      await host.emit({ type: "state", phase: "SUSPENDED" });
    else source.dispose();
    await observed;
    complete(new Uint8Array(16).fill(99));
    if (mode !== "dispose") {
      if (mode !== "suspend")
        await vi.waitFor(() =>
          expect(host.commands.some((c) => c.method === "cancel")).toBe(true),
        );
      if (mode === "suspend")
        await host.emit({ type: "state", phase: "CONNECTED" });
      await expect(source.fetch("/health")).resolves.toEqual({ healthy: true });
      expect(source.status.getSnapshot().state).toBe("ready");
    }
  },
);

it("fails a truncated body instead of returning a successful short movie", async () => {
  const { host, source } = await setup();
  host.handler = (c) =>
    c.method === "responseStart"
      ? { streaming: true, responseId: c.id, status: 200, length: 10 }
      : { done: true };
  const response = await source.fetchStream("/movie");
  await expect(response.arrayBuffer()).rejects.toThrow("Incomplete");
});

it("retains buffered JSON compatibility and decodes only explicit binary downloads", async () => {
  const { host, source } = await setup();
  const text = '{ "value": 9007199254740993 }\n';
  const envelope = { _binary: true, data: btoa(text) };
  host.handler = () => ({
    streaming: false,
    status: 200,
    headers: { "content-type": "application/json" },
    body: envelope,
  });
  expect(await (await source.fetchStream("/file?download=true")).text()).toBe(
    text,
  );
  expect(await (await source.fetchStream("/ordinary-json")).json()).toEqual(
    envelope,
  );
});

it("bounds abandoned bodies and expires idle readers without closing the bridge", async () => {
  const { host, source } = await setup();
  host.handler = (c) => ({ streaming: true, responseId: c.id, status: 200 });
  vi.useFakeTimers();
  const responses = [];
  for (let i = 0; i < 8; i++)
    responses.push(await source.fetchStream("/movie"));
  const waiting = source.fetchStream("/movie");
  await vi.advanceTimersByTimeAsync(15_000);
  await (await waiting).body?.cancel();
  await expect(responses[0]!.arrayBuffer()).rejects.toThrow("idle timeout");
  expect(source.status.getSnapshot().state).toBe("ready");
});

it("admits twenty concurrent consumers within eight native body slots", async () => {
  const { host, source } = await setup();
  const live = new Set<string>();
  const read = new Set<string>();
  let peak = 0;
  host.handler = (command) => {
    if (command.method === "responseStart") {
      live.add(String(command.id));
      peak = Math.max(peak, live.size);
      return {
        streaming: true,
        responseId: command.id,
        status: 200,
        length: 1,
      };
    }
    const id = (command.params as { responseId: string }).responseId;
    if (!read.has(id)) {
      read.add(id);
      return new Uint8Array([42]);
    }
    live.delete(id);
    return { done: true };
  };
  const results = await Promise.all(
    Array.from({ length: 20 }, async () => [
      ...new Uint8Array(
        await (await source.fetchStream("/asset")).arrayBuffer(),
      ),
    ]),
  );
  expect(results).toEqual(Array.from({ length: 20 }, () => [42]));
  expect(peak).toBeLessThanOrEqual(8);
  expect(live.size).toBe(0);
});

it("removes an aborted waiter and makes a cancelled slot available to a new range", async () => {
  const { host, source } = await setup();
  host.handler = (c) =>
    c.method === "responseStart"
      ? { streaming: true, responseId: c.id, status: 206 }
      : {};
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => source.fetchStream("/movie")),
  );
  const abort = new AbortController();
  const waiting = source.fetchStream("/movie", { signal: abort.signal });
  const rejected = expect(waiting).rejects.toMatchObject({
    name: "AbortError",
  });
  abort.abort();
  await rejected;
  const seek = source.fetchStream("/movie", {
    headers: { Range: "bytes=999-" },
  });
  await responses[0]!.body!.cancel();
  const next = await seek;
  expect(
    host.commands.filter((c) => c.method === "responseStart"),
  ).toHaveLength(9);
  await next.body!.cancel();
});

it("keeps a pending chunk read alive past the ordinary bridge request deadline", async () => {
  const { host, source } = await setup();
  let complete!: (chunk: { done: true }) => void;
  host.handler = (c) =>
    c.method === "responseStart"
      ? { streaming: true, responseId: c.id, status: 200 }
      : new Promise((resolve) => {
          complete = resolve;
        });
  vi.useFakeTimers();
  const response = await source.fetchStream("/quiet");
  const read = response.body!.getReader().read();
  const observed = expect(read).resolves.toMatchObject({ done: true });
  await vi.advanceTimersByTimeAsync(0);
  // An active pull extends the body budget to the chunk deadline.
  await vi.advanceTimersByTimeAsync(31_000);
  complete({ done: true });
  await observed;
});

it("retries a safe read interrupted before headers after the native lease resumes", async () => {
  const { host, source } = await setup();
  let starts = 0;
  host.handler = (c) => {
    if (c.method === "responseStart" && ++starts === 1)
      return new Promise(() => {});
    return {
      streaming: false,
      status: 200,
      headers: { "content-type": "text/javascript" },
      body: "x".repeat(2 * 1024 * 1024),
    };
  };
  const pending = source.fetchStream("/bundle.js");
  await vi.waitFor(() => expect(starts).toBe(1));
  await host.emit({ type: "state", phase: "SUSPENDED" });
  await host.emit({ type: "state", phase: "CONNECTED" });
  expect((await (await pending).text()).length).toBe(2 * 1024 * 1024);
  expect(starts).toBe(2);
});
