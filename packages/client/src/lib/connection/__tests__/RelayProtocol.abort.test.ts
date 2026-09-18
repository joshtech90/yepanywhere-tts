import type { RelayRequest, RemoteClientMessage } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import { RelayProtocol, type RelayTransport } from "../RelayProtocol";

function harness() {
  const sent: RemoteClientMessage[] = [];
  const transport: RelayTransport = {
    sendMessage: (msg) => {
      sent.push(msg);
    },
    sendUploadChunk: vi.fn(async () => undefined),
    ensureConnected: vi.fn(async () => undefined),
    isConnected: vi.fn(() => true),
  };
  return { sent, transport, protocol: new RelayProtocol(transport) };
}

function requestIds(sent: RemoteClientMessage[]): string[] {
  return sent
    .filter((msg): msg is RelayRequest => msg.type === "request")
    .map((msg) => msg.id);
}

/** A request reaches the wire only after `ensureConnected` resolves. */
async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for the request to be sent");
}

describe("RelayProtocol request cancellation", () => {
  it("rejects an in-flight request when its signal aborts", async () => {
    const { sent, protocol } = harness();
    const controller = new AbortController();

    const pending = protocol.fetch("/sessions/content-search", {
      method: "POST",
      signal: controller.signal,
    });
    await flushUntil(() => requestIds(sent).length === 1);
    expect(protocol.pendingRequests.size).toBe(1);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // The pending slot is released immediately rather than held until the
    // request deadline, so a late reply is discarded instead of resolving a
    // caller that has already navigated away.
    expect(protocol.pendingRequests.size).toBe(0);
  });

  it("discards the reply to an abandoned request without warning", async () => {
    const { sent, protocol } = harness();
    const controller = new AbortController();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const pending = protocol.fetch("/sessions/content-search", {
      method: "POST",
      signal: controller.signal,
    });
    await flushUntil(() => requestIds(sent).length === 1);
    const id = requestIds(sent)[0]!;
    controller.abort();
    await expect(pending).rejects.toThrow();

    // The relay has no cancel frame, so the server answers anyway. That reply
    // is expected, not the unknown-request anomaly the warning exists for.
    protocol.routeMessage({
      type: "response",
      id,
      status: 200,
      headers: {},
      body: { done: true },
    } as never);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("preserves the signal's reason so a deadline stays distinguishable", async () => {
    const { protocol } = harness();
    const controller = new AbortController();
    const reason = new DOMException("took too long", "TimeoutError");

    const pending = protocol.fetch("/projects", { signal: controller.signal });
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("never sends a request whose signal already aborted", async () => {
    const { sent, protocol } = harness();

    await expect(
      protocol.fetch("/projects", { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(requestIds(sent)).toHaveLength(0);
    expect(protocol.pendingRequests.size).toBe(0);
  });

  it("drops its abort listener once a request settles", async () => {
    const { sent, protocol } = harness();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");

    // A scan reuses one controller across every batch, so a listener left
    // behind per request accumulates for the life of the scan.
    for (let batch = 0; batch < 3; batch++) {
      const pending = protocol.fetch("/sessions/content-search", {
        method: "POST",
        signal: controller.signal,
      });
      await flushUntil(() => requestIds(sent).length === batch + 1);
      const id = requestIds(sent)[batch]!;
      protocol.routeMessage({
        type: "response",
        id,
        status: 200,
        headers: {},
        body: { done: true },
      } as never);
      await expect(pending).resolves.toMatchObject({ done: true });
    }

    expect(added).toHaveBeenCalledTimes(3);
    expect(removed).toHaveBeenCalledTimes(3);
  });
});
