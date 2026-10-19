const PROTOCOL = "yep-artifact-preview/1";
const viewerId = new URLSearchParams(location.search).get("viewer");
const expectedParent = document.querySelector(
  'meta[name="ya-parent-origin"]',
).content;
let hostPort;
let registration;
let closed = false;
let frame;
navigator.serviceWorker?.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (
    !port ||
    !hostPort ||
    closed ||
    event.data?.protocol !== PROTOCOL ||
    event.data.type !== "read" ||
    event.data.viewerId !== viewerId
  ) {
    port?.close();
    return;
  }
  hostPort.postMessage(event.data, [port]);
});
navigator.serviceWorker?.startMessages();
addEventListener("message", (event) => {
  if (
    event.source === parent &&
    event.origin === expectedParent &&
    event.data?.protocol === "yep-find/1"
  ) {
    frame?.contentWindow?.postMessage(event.data, location.origin);
  } else if (
    event.source === frame?.contentWindow &&
    event.origin === location.origin
  ) {
    if (event.data?.protocol === "yep-find/1")
      parent.postMessage(event.data, expectedParent);
    else if (
      event.data?.protocol === PROTOCOL &&
      ["widget-state", "followup"].includes(event.data.type) &&
      hostPort &&
      !closed
    ) {
      if (event.data.type === "widget-state")
        window.__yepArtifactInit.widgetState = event.data.state;
      hostPort.postMessage(event.data);
    }
  }
});
addEventListener("message", async (event) => {
  if (
    event.source !== parent ||
    event.origin !== expectedParent ||
    event.data?.protocol !== PROTOCOL ||
    event.data.type !== "connect" ||
    event.data.viewerId !== viewerId ||
    hostPort ||
    !event.ports[0]
  )
    return;
  hostPort = event.ports[0];
  hostPort.onmessage = async (event) => {
    if (event.data?.protocol !== PROTOCOL) return;
    if (event.data.type === "close") {
      closed = true;
      frame?.remove();
      await registration?.unregister();
      hostPort.postMessage({ protocol: PROTOCOL, type: "closed" });
      hostPort.close();
    }
  };
  try {
    registration = await navigator.serviceWorker.register("/__ya/1/worker.js", {
      scope: "/v/",
      updateViaCache: "none",
    });
    const worker =
      registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error("Worker unavailable");
    if (worker.state !== "activated")
      await new Promise((resolve, reject) => {
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
          if (worker.state === "redundant")
            reject(new Error("Worker replaced"));
        });
      });
    if (closed) {
      await registration.unregister();
      return;
    }
    window.__yepArtifactInit = {
      theme: event.data.theme,
      widgetState: event.data.widgetState,
    };
    frame = document.createElement("iframe");
    frame.sandbox = "allow-scripts allow-same-origin allow-downloads";
    frame.title = event.data.title ?? "Artifact";
    frame.src = `/v/${viewerId}/${event.data.entry.split("/").map(encodeURIComponent).join("/")}`;
    document.body.append(frame);
    hostPort.postMessage({ protocol: PROTOCOL, type: "registered" });
  } catch {
    hostPort.postMessage({ protocol: PROTOCOL, type: "failed" });
    document.body.textContent =
      "Artifact viewer unavailable. Return to Yep Anywhere to retry.";
  }
});
parent.postMessage(
  { protocol: PROTOCOL, type: "ready", viewerId },
  expectedParent,
);

addEventListener("pagehide", () => {
  closed = true;
  void registration?.unregister().catch(() => {});
  hostPort?.close();
});
