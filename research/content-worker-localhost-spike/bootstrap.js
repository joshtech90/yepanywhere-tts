const params = new URLSearchParams(location.search);
const viewerId = params.get("viewer");
const expectedParent = document.querySelector(
  'meta[name="ya-parent-origin"]',
).content;
let hostPort;
let registration;
let closed = false;
navigator.serviceWorker?.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (
    !port ||
    !hostPort ||
    closed ||
    event.data?.type !== "read" ||
    event.data.viewerId !== viewerId
  ) {
    port?.close();
    return;
  }
  hostPort.postMessage(event.data, [port]);
});
navigator.serviceWorker?.startMessages();
addEventListener("message", async function connect(event) {
  if (
    event.source !== parent ||
    event.origin !== expectedParent ||
    event.data?.type !== "connect" ||
    hostPort ||
    !event.ports[0]
  )
    return;
  hostPort = event.ports[0];
  hostPort.onmessage = async (event) => {
    if (event.data?.type !== "close") return;
    closed = true;
    document.querySelector("iframe")?.remove();
    await registration?.unregister();
    hostPort.postMessage({ type: "closed" });
    hostPort.close();
  };
  try {
    registration = await navigator.serviceWorker.register("/__ya/worker.js", {
      scope: "/v/",
    });
    const worker =
      registration.installing ?? registration.waiting ?? registration.active;
    if (worker.state !== "activated")
      await new Promise((resolve, reject) => {
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
          if (worker.state === "redundant")
            reject(new Error("Worker became redundant"));
        });
      });
    hostPort.postMessage({
      type: "registered",
      secure: isSecureContext,
      originAgentCluster: self.originAgentCluster,
    });
    const frame = document.createElement("iframe");
    frame.sandbox = "allow-scripts allow-same-origin";
    frame.title = "Local artifact document";
    frame.src = `/v/${viewerId}/${event.data.entry}`;
    document.body.append(frame);
  } catch (error) {
    hostPort.postMessage({
      type: "failed",
      secure: isSecureContext,
      error: String(error),
    });
    document.body.textContent = `Worker unavailable: ${error}`;
  }
});
parent.postMessage({ type: "content-ready", viewerId }, expectedParent);
