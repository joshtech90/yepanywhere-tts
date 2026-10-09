import { afterEach, expect, it, vi } from "vitest";
import { NativeOperationError } from "../../nativeTransportBridge";
import {
  ConnectionReconnectingError,
  SubscriptionError,
} from "../../connection/types";
import { createManagedStream } from "../ManagedStream";
import { NativeSourceTransport } from "../NativeSourceTransport";
import { NativeTransportFixture } from "./nativeTransportFixture";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.reverse()) close();
  cleanup.length = 0;
  vi.useRealTimers();
});
async function setup() {
  const host = new NativeTransportFixture();
  const transport = new NativeSourceTransport(host.channel);
  cleanup.push(() => transport.dispose());
  await transport.ready;
  await vi.waitFor(() =>
    expect(transport.status.getSnapshot().state).toBe("ready"),
  );
  return { host, transport };
}
function subscriptions(host: NativeTransportFixture) {
  return host.commands
    .filter((command) => command.method === "subscribe")
    .map(
      (command) =>
        command.params as { subscriptionId: string; lastEventId?: string },
    );
}

it("retires the old native subscription while reconnecting and resumes from the consumed event", async () => {
  const { host, transport } = await setup();
  const events = vi.fn();
  const stream = createManagedStream(
    transport,
    {
      subscribe: ({ handlers, lastEventId }) =>
        transport.subscribeSession("session", handlers, lastEventId),
      onEvent: events,
    },
    {},
  );
  cleanup.push(() => stream.close());
  await vi.waitFor(() => expect(subscriptions(host)).toHaveLength(1));
  const old = subscriptions(host)[0]!;
  await host.emit({
    type: "event",
    subscriptionId: old.subscriptionId,
    eventType: "connected",
    eventId: "4",
    data: {},
  });
  await host.emit({ type: "state", phase: "RETRYING" });
  await vi.waitFor(() =>
    expect(
      host.commands
        .filter((c) => c.method === "unsubscribe")
        .map((c) => c.params),
    ).toEqual([{ subscriptionId: old.subscriptionId }]),
  );
  await host.emit({ type: "state", phase: "CONNECTED" });
  await vi.waitFor(() => expect(subscriptions(host)).toHaveLength(2));
  const fresh = subscriptions(host)[1]!;
  expect(fresh.subscriptionId).not.toBe(old.subscriptionId);
  expect(fresh.lastEventId).toBe("4");
  await host.emit({
    type: "event",
    subscriptionId: old.subscriptionId,
    eventType: "message",
    eventId: "5",
    data: "abandoned",
  });
  await host.emit({
    type: "event",
    subscriptionId: fresh.subscriptionId,
    eventType: "message",
    eventId: "5",
    data: "caught up",
  });
  expect(events.mock.calls.map(([event]) => event.data)).toEqual([
    {},
    "caught up",
  ]);
});

it.each(["CONNECTION_UNAVAILABLE", "OVERFLOW", "INVALID_MESSAGE"])(
  "preserves native subscription failure %s without inventing a status",
  async (errorCode) => {
    const { host, transport } = await setup();
    const onError = vi.fn();
    const subscription = transport.subscribeActivity({
      onEvent: vi.fn(),
      onError,
    });
    cleanup.push(() => subscription.close());
    await vi.waitFor(() => expect(subscriptions(host)).toHaveLength(1));
    await host.emit({
      type: "subscriptionError",
      subscriptionId: subscriptions(host)[0]!.subscriptionId,
      errorCode,
      error: "native failure",
    });
    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]![0];
    expect(error).not.toHaveProperty("status");
    if (errorCode === "CONNECTION_UNAVAILABLE")
      expect(error).toBeInstanceOf(ConnectionReconnectingError);
    else expect(error).toMatchObject({ code: errorCode });
  },
);

it("keeps a real server rejection distinct and does not retry native verification errors", async () => {
  const { host, transport } = await setup();
  const errors: Error[] = [];
  const stream = createManagedStream(
    transport,
    {
      subscribe: ({ handlers }) => transport.subscribeActivity(handlers),
      onEvent: () => {},
      onError: (error) => errors.push(error),
    },
    {},
  );
  cleanup.push(() => stream.close());
  await vi.waitFor(() => expect(subscriptions(host)).toHaveLength(1));
  await host.emit({
    type: "subscriptionError",
    subscriptionId: subscriptions(host)[0]!.subscriptionId,
    errorCode: "INVALID_MESSAGE",
    error: "invalid proof",
  });
  expect(errors[0]).toBeInstanceOf(NativeOperationError);
  expect(stream.getSnapshot().state).toBe("terminal");
  const rejected = vi.fn();
  transport.subscribeActivity({ onEvent: () => {}, onError: rejected });
  await vi.waitFor(() => expect(subscriptions(host)).toHaveLength(2));
  await host.emit({
    type: "subscriptionError",
    subscriptionId: subscriptions(host)[1]!.subscriptionId,
    status: 403,
    error: "denied by server",
  });
  expect(rejected.mock.calls[0]![0]).toBeInstanceOf(SubscriptionError);
  expect(rejected.mock.calls[0]![0]).toHaveProperty("status", 403);
});

it("keeps repeated reconnects within one native subscription and ignores late setup errors", async () => {
  const { host, transport } = await setup();
  // Count ownership across 70 cycles without paying a 50 ms polling interval per cycle.
  const owned = new Set<string>();
  host.handler = (command) => {
    const id = (command.params as { subscriptionId: string }).subscriptionId;
    if (command.method === "subscribe") owned.add(id);
    if (command.method === "unsubscribe") owned.delete(id);
    return {};
  };
  const stream = createManagedStream(transport, {
    subscribe: ({ handlers }) => transport.subscribeActivity(handlers),
    onEvent: () => {},
  });
  cleanup.push(() => stream.close());
  for (let cycle = 0; cycle < 70; cycle++) {
    await vi.waitFor(
      () => expect(subscriptions(host)).toHaveLength(cycle + 1),
      { interval: 1 },
    );
    expect(owned.size).toBe(1);
    const old = subscriptions(host).at(-1)!;
    await host.emit({ type: "state", phase: "RETRYING" });
    await vi.waitFor(() => expect(owned.size).toBe(0), { interval: 1 });
    await host.emit({ type: "state", phase: "CONNECTED" });
    await host.emit({
      type: "subscriptionError",
      subscriptionId: old.subscriptionId,
      errorCode: "CONNECTION_UNAVAILABLE",
      error: "late",
    });
    expect(transport.status.getSnapshot().state).toBe("ready");
  }
});

it("preserves a typed bridge setup rejection before any stream event", async () => {
  const { host, transport } = await setup();
  host.handler = () => new Promise(() => {});
  const error = vi.fn();
  transport.subscribeActivity({ onEvent: () => {}, onError: error });
  await vi.waitFor(() => expect(host.commands).toHaveLength(1));
  await host.emit({
    type: "reply",
    id: host.commands[0]!.id,
    errorCode: "OVERFLOW",
    error: "full",
  });
  await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(error.mock.calls[0]![0]).toMatchObject({ code: "OVERFLOW" });
  expect(error.mock.calls[0]![0]).not.toHaveProperty("status");
  expect(transport.status.getSnapshot().state).toBe("ready");
});
