import { afterEach, expect, it, vi } from "vitest";
import { NativeSourceTransport } from "../NativeSourceTransport";
import { NativeTransportFixture } from "./nativeTransportFixture";

const sources: NativeSourceTransport[] = [];
async function setup(stateQuery = false) {
  const host = new NativeTransportFixture(true, "CONNECTED", false, stateQuery);
  const source = new NativeSourceTransport(host.channel);
  sources.push(source);
  await source.ready;
  await vi.waitFor(() =>
    expect(source.status.getSnapshot().state).toBe("ready"),
  );
  return { host, source };
}
afterEach(() => {
  for (const source of sources.splice(0)) source.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("does not replace a healthy native connection because the WebView reports offline", async () => {
  const { host, source } = await setup();
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  window.dispatchEvent(new Event("offline"));
  await host.emit({ type: "state", phase: "CONNECTED", recoverable: false });
  expect(source.status.getSnapshot().state).toBe("ready");
  await expect(source.fetch("/projects")).resolves.toEqual({ ok: true });
  online.mockReturnValue(true);
  window.dispatchEvent(new Event("online"));
  await Promise.resolve();
  expect(host.commands.map((c) => c.method)).toEqual(["request"]);
});

it("holds visible resume reads and publishes one recovery state across native lease edges", async () => {
  const { host, source } = await setup();
  const states: string[] = [];
  source.status.subscribe(() => states.push(source.status.getSnapshot().state));
  await host.emit({ type: "state", phase: "SUSPENDED" });
  const read = source.fetch("/projects");
  const result = expect(read).resolves.toEqual({ ok: true });
  for (const phase of ["CONNECTING", "IDLE", "RETRYING", "CONNECTED"])
    await host.emit({ type: "state", phase, recoverable: true });
  await result;
  expect(states).toEqual(["reconnecting", "ready"]);
  expect(host.commands.map((c) => c.method)).toEqual(["request"]);
});

it("coalesces exhausted recovery signals for five seconds, including network availability", async () => {
  const { host } = await setup();
  vi.useFakeTimers();
  host.handler = () => Promise.reject(new Error("fixture outage"));
  await host.emit({ type: "state", phase: "FAILED", recoverable: true });
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(1100);
    document.dispatchEvent(new Event("pointerdown"));
    await host.emit({ type: "networkAvailable" });
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(host.commands.filter((c) => c.method === "reconnect")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(600);
  document.dispatchEvent(new Event("pointerdown"));
  await vi.advanceTimersByTimeAsync(0);
  expect(host.commands.filter((c) => c.method === "reconnect")).toHaveLength(2);
});

it("ignores a late operation failure after a newer native connected observation", async () => {
  const { host, source } = await setup();
  let calls = 0;
  host.handler = () =>
    ++calls === 1
      ? new Promise(() => {})
      : { status: 200, body: { recovered: true } };
  const pending = source.fetch("/projects");
  void pending.catch(() => {});
  await vi.waitFor(() => expect(host.commands).toHaveLength(1));
  await host.emit({ type: "state", phase: "CONNECTED", recoverable: false });
  await host.emit({
    type: "reply",
    id: host.commands[0]?.id,
    errorCode: "CONNECTION_UNAVAILABLE",
    error: "old operation",
  });
  await vi.waitFor(() => expect(host.commands).toHaveLength(2));
  await expect(pending).resolves.toEqual({ recovered: true });
  expect(source.status.getSnapshot().state).toBe("ready");
});

it("queries native state after a current operation failure without destructively reconnecting", async () => {
  const { host, source } = await setup(true);
  let calls = 0;
  host.handler = (c) =>
    c.method === "status"
      ? { phase: "CONNECTED", recoverable: false }
      : ++calls === 1
        ? new Promise(() => {})
        : { status: 200, body: { recovered: true } };
  const pending = source.fetch("/projects");
  void pending.catch(() => {});
  await vi.waitFor(() => expect(host.commands).toHaveLength(1));
  await host.emit({
    type: "reply",
    id: host.commands[0]?.id,
    errorCode: "CONNECTION_UNAVAILABLE",
    error: "operation interrupted",
  });
  await vi.waitFor(() =>
    expect(host.commands.map((c) => c.method)).toEqual([
      "request",
      "status",
      "request",
    ]),
  );
  await expect(pending).resolves.toEqual({ recovered: true });
  expect(source.status.getSnapshot().state).toBe("ready");
});

it("reattaches once when a coalesced connected state belongs to a new native lease", async () => {
  const { host, source } = await setup();
  await host.emit({ type: "state", phase: "CONNECTED", leaseGeneration: 1 });
  const states: string[] = [];
  source.status.subscribe(() => states.push(source.status.getSnapshot().state));
  await host.emit({ type: "state", phase: "CONNECTED", leaseGeneration: 3 });
  await host.emit({ type: "state", phase: "CONNECTED", leaseGeneration: 3 });
  await host.emit({ type: "state", phase: "SUSPENDED", leaseGeneration: 2 });
  expect(states).toEqual(["reconnecting", "ready"]);
});

it("reattaches when native socket epochs change even if retry state was coalesced", async () => {
  const { host, source } = await setup();
  await host.emit({
    type: "state",
    phase: "CONNECTED",
    leaseGeneration: 1,
    connectionEpoch: 4,
  });
  const states: string[] = [];
  source.status.subscribe(() => states.push(source.status.getSnapshot().state));
  await host.emit({
    type: "state",
    phase: "CONNECTED",
    leaseGeneration: 1,
    connectionEpoch: 5,
  });
  await host.emit({
    type: "state",
    phase: "CONNECTED",
    leaseGeneration: 1,
    connectionEpoch: 5,
  });
  await host.emit({
    type: "state",
    phase: "CONNECTED",
    leaseGeneration: 1,
    connectionEpoch: 4,
  });
  expect(states).toEqual(["reconnecting", "ready"]);
});
