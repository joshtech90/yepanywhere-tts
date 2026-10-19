// @vitest-environment node
import { MessageChannel } from "node:worker_threads";
import { afterEach, expect, it, vi } from "vitest";
import {
  connectManagedArtifactViewer,
  ARTIFACT_PREVIEW_PROTOCOL,
} from "../managedArtifactViewer";
import type { SourceTransport } from "../transport/types";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllGlobals();
});
function viewer(
  transport: Pick<SourceTransport, "fetchStream">,
  expiresAt = Date.now() + 60_000,
) {
  let ready!: (event: unknown) => void;
  let remote!: MessagePort;
  vi.stubGlobal("MessageChannel", MessageChannel);
  vi.stubGlobal("window", {
    addEventListener: (_: string, callback: typeof ready) => {
      ready = callback;
    },
    removeEventListener() {},
  });
  const viewerId = crypto.randomUUID().replaceAll("-", "");
  const source = {
    postMessage: (_: unknown, _origin: string, ports: MessagePort[]) => {
      remote = ports[0]!;
    },
  };
  const origin = `https://artifact-${viewerId}.yepanywhere.com`;
  const failure = vi.fn();
  const followUp = vi.fn();
  const frame = {
    src: `${origin}/__ya/1/bootstrap.html`,
    contentWindow: source,
    isConnected: false,
  } as unknown as HTMLIFrameElement;
  const close = connectManagedArtifactViewer({
    frame,
    viewerId,
    lease: { id: "lease", entry: "index.html", expiresAt },
    base: "/artifact-previews",
    transport: transport as SourceTransport,
    title: "test",
    theme: "light",
    widgetState: null,
    onWidgetState() {},
    onFollowUp: followUp,
    onReady() {},
    onFailure: failure,
  });
  ready({
    source,
    origin,
    data: { protocol: ARTIFACT_PREVIEW_PROTOCOL, type: "ready", viewerId },
  });
  remote.postMessage({
    protocol: ARTIFACT_PREVIEW_PROTOCOL,
    type: "registered",
  });
  cleanups.push(close, () => remote.close());
  function read(path = "asset.bin") {
    const { port1, port2 } = new MessageChannel();
    cleanups.push(() => port1.close());
    const messages: Record<string, unknown>[] = [];
    port1.on("message", (message) => {
      messages.push(message);
      if (
        message.status === 200 ||
        message.status === 206 ||
        message.type === "chunk"
      )
        port1.postMessage({ type: "pull" });
    });
    remote.postMessage(
      { protocol: ARTIFACT_PREVIEW_PROTOCOL, type: "read", viewerId, path },
      [port2],
    );
    return { port: port1, messages };
  }
  return { read, close, failure, followUp, frame, remote };
}
it("queues a resource burst, streams exact download bytes, and cancels queued work on close", async () => {
  const pending: ((response: Response) => void)[] = [];
  const paths: string[] = [];
  const owned = viewer({
    fetchStream: (path) => {
      paths.push(path);
      return new Promise<Response>((resolve) => pending.push(resolve));
    },
  });
  const reads = Array.from({ length: 24 }, () => owned.read("precise.json"));
  await vi.waitFor(() => expect(pending).toHaveLength(8));
  expect(reads.every((read) => read.messages.length === 0)).toBe(true);
  expect(
    paths.every(
      (path) =>
        new URL(path, "https://test").searchParams.get("download") === "true",
    ),
  ).toBe(true);
  for (const resolve of pending.splice(0)) {
    resolve(new Response('{ "n": 9007199254740993 }\n'));
  }
  await vi.waitFor(() =>
    expect(
      reads.filter((read) =>
        read.messages.some((message) => message.type === "end"),
      ),
    ).toHaveLength(8),
  );
  await vi.waitFor(() => expect(pending).toHaveLength(8));
  await owned.close();
  for (const resolve of pending.splice(0)) resolve(new Response("late"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(paths).toHaveLength(16);
  expect(owned.failure).not.toHaveBeenCalled();
});
it("surfaces lease loss from an asset and expiry, but leaves ordinary missing assets local", async () => {
  const responses = [
    new Response('{"error":"Missing"}', { status: 404 }),
    new Response('{"reason":"preview-unavailable"}', { status: 404 }),
  ];
  const owned = viewer({ fetchStream: async () => responses.shift()! });
  const missing = owned.read();
  await vi.waitFor(() => expect(missing.messages[0]?.status).toBe(404));
  expect(owned.failure).not.toHaveBeenCalled();
  owned.read();
  await vi.waitFor(() => expect(owned.failure).toHaveBeenCalledOnce());
  const expired = viewer(
    { fetchStream: async () => new Response("") },
    Date.now() + 25,
  );
  await vi.waitFor(() => expect(expired.failure).toHaveBeenCalledOnce());
});
it("shares the tab budget across viewers and starts another viewer when slots are released", async () => {
  const starts = [0, 0, 0, 0, 0];
  const viewers = starts.map((_, index) =>
    viewer({
      fetchStream: () => {
        starts[index]!++;
        return new Promise<Response>(() => {});
      },
    }),
  );
  for (const owned of viewers) for (let i = 0; i < 8; i++) owned.read();
  await vi.waitFor(() => expect(starts).toEqual([8, 8, 8, 8, 0]));
  await viewers[0]!.close();
  await vi.waitFor(() => expect(starts).toEqual([8, 8, 8, 8, 8]));
});

it("requires both activation and viewer focus before inserting a follow-up", async () => {
  const owned = viewer({ fetchStream: async () => new Response("") });
  vi.stubGlobal("navigator", { userActivation: { isActive: true } });
  const document = { activeElement: {} };
  vi.stubGlobal("document", document);
  // Activation elsewhere in YA (such as composer typing) is insufficient.
  owned.remote.postMessage({
    protocol: ARTIFACT_PREVIEW_PROTOCOL,
    type: "followup",
    text: "while typing",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(owned.followUp).not.toHaveBeenCalled();
  // Exercise the focus condition without granting any file or send authority.
  document.activeElement = owned.frame;
  owned.remote.postMessage({
    protocol: ARTIFACT_PREVIEW_PROTOCOL,
    type: "followup",
    text: "from viewer",
  });
  await vi.waitFor(() =>
    expect(owned.followUp).toHaveBeenCalledExactlyOnceWith("from viewer"),
  );
});
