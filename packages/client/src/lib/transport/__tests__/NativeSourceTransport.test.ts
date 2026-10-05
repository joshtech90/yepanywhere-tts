import { afterEach, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import { NativeSourceTransport } from "../NativeSourceTransport";
import { NativeTransportFixture } from "./nativeTransportFixture";

const transports: NativeSourceTransport[] = [];
async function setup(binary = true) {
  const host = new NativeTransportFixture(binary);
  const transport = new NativeSourceTransport(host.channel);
  transports.push(transport);
  await transport.ready;
  await vi.waitFor(() =>
    expect(transport.status.getSnapshot().state).toBe("ready"),
  );
  return { host, transport };
}
afterEach(() => {
  for (const transport of transports.splice(0)) transport.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native source transport", () => {
  it("does not expire frame credit while the WebView is hidden", async () => {
    const { host, transport } = await setup();
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const original = host.channel.postMessage;
    let frame: string | ArrayBuffer | undefined;
    host.channel.postMessage = (value) => {
      frame = value;
    };
    const send = transport.bridge.send(
      1,
      new TextEncoder().encode(
        JSON.stringify({
          handle: "document-one",
          method: "cancel",
          id: "one",
          params: { id: "none" },
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(1);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(host.channel.onmessage).not.toBeNull();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    host.channel.postMessage = original;
    if (frame === undefined) throw new Error("No frame was sent");
    original(frame);
    await send;
    expect(transport.status.getSnapshot().state).toBe("ready");
  });

  it("suspends demand without closing the document bridge and resumes in place", async () => {
    const { host, transport } = await setup();
    const descriptor = transport.bridge.descriptor;
    let complete!: (value: unknown) => void;
    host.handler = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    const request = transport.fetch("/projects");
    const failed = expect(request).rejects.toThrow();
    await vi.waitFor(() => expect(host.commands).toHaveLength(1));
    await host.emit({ type: "state", phase: "SUSPENDED" });
    await failed;
    expect(transport.status.getSnapshot().state).toBe("disconnected");
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    await expect(transport.reconnect()).rejects.toThrow();
    expect(host.commands).toHaveLength(1);
    complete({ status: 200, body: { stale: true } });
    await host.emit({ type: "state", phase: "CONNECTING" });
    await host.emit({ type: "state", phase: "CONNECTED" });
    expect(transport.bridge.descriptor).toBe(descriptor);
    host.handler = () => ({ status: 200, body: { recovered: true } });
    await expect(transport.fetch("/projects")).resolves.toEqual({
      recovered: true,
    });
  });

  it("recovers an exhausted cold connection on online and coalesces input signals", async () => {
    const { host, transport } = await setup();
    let finish!: () => void;
    host.handler = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    await host.emit({ type: "state", phase: "FAILED" });
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("pointerdown"));
    await vi.waitFor(() => expect(host.commands).toHaveLength(1));
    expect(host.commands[0]?.method).toBe("reconnect");
    finish();
    await vi.waitFor(() =>
      expect(transport.status.getSnapshot().state).toBe("ready"),
    );
  });

  it("shows loss immediately and waits for network restoration before recovery", async () => {
    const { host, transport } = await setup();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    expect(transport.status.getSnapshot().state).toBe("disconnected");
    await host.emit({ type: "state", phase: "CONNECTED" });
    expect(transport.status.getSnapshot().state).toBe("disconnected");
    window.dispatchEvent(new Event("focus"));
    expect(host.commands).toHaveLength(0);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() =>
      expect(transport.status.getSnapshot().state).toBe("ready"),
    );
    expect(host.commands).toHaveLength(1);
  });

  it("pauses exhausted recovery while hidden and stops it on disposal or rejection", async () => {
    const { host, transport } = await setup();
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await host.emit({ type: "state", phase: "FAILED" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(host.commands).toHaveLength(0);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1);
    expect(host.commands).toHaveLength(1);
    await host.emit({ type: "state", phase: "REAUTHENTICATION_REQUIRED" });
    window.dispatchEvent(new Event("offline"));
    expect(transport.authenticationRequired).toBe(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(host.commands).toHaveLength(1);
    transport.dispose();
    window.dispatchEvent(new Event("online"));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains unchanged phase snapshots while preserving authentication transitions", async () => {
    const { host, transport } = await setup();
    const changed = vi.fn();
    const authenticate = vi.fn();
    transport.status.subscribe(changed);
    transport.onAuthenticationRequired = authenticate;
    const connected = transport.status.getSnapshot();
    for (let index = 0; index < 20; index++) {
      await host.emit({ type: "state", phase: "CONNECTED" });
    }
    expect(transport.status.getSnapshot()).toBe(connected);
    expect(changed).not.toHaveBeenCalled();
    await host.emit({ type: "state", phase: "RETRYING" });
    const reconnecting = transport.status.getSnapshot();
    expect(reconnecting.state).toBe("reconnecting");
    await host.emit({ type: "state", phase: "RETRYING" });
    expect(transport.status.getSnapshot()).toBe(reconnecting);
    expect(changed).toHaveBeenCalledTimes(1);
    await host.emit({ type: "state", phase: "FAILED" });
    await host.emit({ type: "state", phase: "REAUTHENTICATION_REQUIRED" });
    await host.emit({ type: "state", phase: "REVOKED" });
    expect(transport.status.getSnapshot().state).toBe("disconnected");
    expect(authenticate).toHaveBeenCalledTimes(2);
  });
  it("waits for cold native demand instead of treating initial idle as terminal", async () => {
    const { host, transport } = await setup();
    await host.emit({ type: "state", phase: "IDLE" });
    const request = transport.fetch("/version");
    await Promise.resolve();
    expect(host.commands).toHaveLength(0);
    await host.emit({ type: "state", phase: "CONNECTED" });
    expect(await request).toEqual({ ok: true });
  });
  it("streams a 1 MiB attachment with credit and native upload handles", async () => {
    const { host, transport } = await setup();
    host.handler = (command) => {
      if (command.method === "uploadEnd") {
        void host.emit({
          type: "upload_complete",
          uploadId: (command.params as { uploadId: string }).uploadId,
          stagedRef: { id: "attachment-one" },
        });
      }
      return {};
    };
    const file = new NodeFile(
      [new Uint8Array(1024 * 1024)],
      "large.bin",
    ) as unknown as File;
    expect(await transport.uploadStagedAttachment(file)).toEqual({
      id: "attachment-one",
    });
    expect(
      host.chunks.reduce((total, chunk) => total + chunk.length - 24, 0),
    ).toBe(file.size);
    expect(host.chunks.every((chunk) => chunk.length <= 65_560)).toBe(true);
  });

  it("aborts an upload while native startup is pending", async () => {
    const { host, transport } = await setup();
    host.handler = (command) =>
      command.method === "uploadStart" ? new Promise(() => {}) : {};
    const controller = new AbortController();
    const file = new NodeFile(["attachment"], "test.txt") as unknown as File;
    const upload = transport.uploadStagedAttachment(file, {
      signal: controller.signal,
    });
    const rejected = expect(upload).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() =>
      expect(host.commands.at(-1)?.method).toBe("uploadStart"),
    );
    controller.abort();
    await rejected;
    await vi.waitFor(() =>
      expect(
        host.commands.some((command) => command.method === "uploadCancel"),
      ).toBe(true),
    );
    expect(host.chunks).toHaveLength(0);
  });

  it.each([true, false])(
    "enters a native source and carries large JSON with binary=%s",
    async (binary) => {
      const { host, transport } = await setup(binary);
      const body = { text: "x".repeat(1024 * 1024) };
      host.handler = () => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body,
      });
      expect(await transport.fetch("/sessions")).toEqual(body);
      expect(host.commands[0]).toMatchObject({
        handle: "document-one",
        method: "request",
        params: { path: "/api/sessions" },
      });
      expect(transport.capabilities).toEqual({ sameOriginUrls: false });
      expect(
        localStorage.getItem("yep-anywhere-remote-credentials"),
      ).toBeNull();
    },
  );

  it("preserves redirects, binary media and API error status", async () => {
    const { host, transport } = await setup();
    host.handler = (command) => {
      const path = (command.params as { path: string }).path;
      if (path === "/api/redirect")
        return { status: 302, headers: { Location: "/api/media" }, body: null };
      if (path === "/api/media")
        return {
          status: 200,
          headers: { "content-type": "image/png" },
          body: { _binary: true, data: btoa("png") },
        };
      return { status: 403, headers: {}, body: { error: "denied" } };
    };
    const response = await transport.fetchResponse("/redirect");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("png");
    await expect(transport.fetch("/forbidden")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("cancels an abandoned native request and ignores its late reply", async () => {
    const { host, transport } = await setup();
    host.handler = () => new Promise(() => {});
    const controller = new AbortController();
    const request = transport.fetch("/slow", { signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(host.commands.length).toBe(1));
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(host.commands.at(-1)?.method).toBe("cancel"));
    expect(host.commands.at(-1)?.params).toEqual({ id: host.commands[0]?.id });
  });

  it("delivers native subscriptions and opens the native host picker", async () => {
    const { host, transport } = await setup();
    const onEvent = vi.fn();
    const subscription = transport.subscribeSession(
      "session-one",
      { onEvent },
      "event-4",
      { wantsLiveDeltas: true },
    );
    await vi.waitFor(() => expect(host.commands.length).toBe(1));
    const params = host.commands[0]?.params as { subscriptionId: string };
    await host.emit({
      type: "event",
      subscriptionId: params.subscriptionId,
      eventType: "text_delta",
      eventId: "event-5",
      data: { text: "Hello" },
    });
    expect(onEvent).toHaveBeenCalledWith("text_delta", "event-5", {
      text: "Hello",
    });
    subscription.close();
    await transport.switchHost();
    expect(
      host.commands.some((command) => command.method === "unsubscribe"),
    ).toBe(true);
    expect(host.commands.at(-1)?.method).toBe("switchHost");
  });
});
