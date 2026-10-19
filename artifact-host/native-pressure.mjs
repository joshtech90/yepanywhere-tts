/** Passive metadata only: no payloads, identities or protocol replacement. */
export function observePressureRelay(relay) {
  const counters = {
    muxOpened: 0,
    muxClosed: 0,
    muxMessages: 0,
    muxMaxMessageBytes: 0,
    serverMessages: 0,
    serverMaxMessageBytes: 0,
  };
  relay.wss.on("connection", (socket, request) => {
    const mux = request.url?.split("?")[0] === "/mux";
    if (mux) counters.muxOpened++;
    socket.on("close", () => {
      if (mux) counters.muxClosed++;
    });
    socket.on("message", (data) => {
      const bytes = Array.isArray(data)
        ? data.reduce((size, chunk) => size + chunk.byteLength, 0)
        : data.byteLength;
      const prefix = mux ? "mux" : "server";
      counters[`${prefix}Messages`]++;
      counters[`${prefix}MaxMessageBytes`] = Math.max(
        counters[`${prefix}MaxMessageBytes`],
        bytes,
      );
    });
  });
  return () => ({ ...counters });
}

/** Diagnostic baseline for the real native socket, without changing framing. */
export async function qualifyNativePressure({
  artifact,
  gate,
  relayStatus,
  relayTraffic,
  sampleMemory,
}) {
  const before = await relayStatus();
  const trafficBefore = relayTraffic();
  const gateBefore = gate.snapshot();
  const samples = [{ elapsedMs: 0, ...(await sampleMemory()) }];
  const start = Date.now();
  gate.setDownloadRate(128 * 1024);
  try {
    await artifact().evaluate(() => {
      const movie = document.querySelector("#local-movie");
      movie.pause();
      movie.removeAttribute("src");
      movie.load();
      const rows = Array.from({ length: 8 }, (_, index) => ({ index }));
      const controllers = rows.map(() => new AbortController());
      const readers = [];
      window.__yaPressure = { rows, controllers, readers };
      rows.forEach(async (row, index) => {
        try {
          const response = await fetch(`media/movie.mp4?pressure=${index}`, {
            headers: { Range: "bytes=0-16777215" },
            signal: controllers[index].signal,
          });
          row.status = response.status;
          const reader = response.body.getReader();
          readers.push(reader);
          const first = await reader.read();
          row.firstBytes = first.value?.length ?? 0;
          // Deliberately retain unread bodies rather than collecting movies in
          // JS arrays. Eight admitted native readers must remain bounded.
        } catch (error) {
          row.error = String(error);
        }
      });
    });
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      samples.push({
        elapsedMs: Date.now() - start,
        ...(await sampleMemory()),
      });
    }
    const rows = await artifact().evaluate(() => window.__yaPressure.rows);
    const after = await relayStatus();
    const relayClosedDelta =
      after.closedByReason.relay_closed - before.closedByReason.relay_closed;
    return {
      rateBytesPerSecond: 128 * 1024,
      concurrentRequests: 8,
      rangeBytesPerRequest: 16 * 1024 * 1024,
      durationMs: Date.now() - start,
      rows,
      relayClosedDelta,
      relayBefore: before,
      relayAfter: after,
      trafficBefore,
      trafficAfter: relayTraffic(),
      gateBefore,
      gate: gate.snapshot(),
      memoryScope:
        "main application process PSS; excludes isolated WebView renderers",
      samples,
      healthy:
        relayClosedDelta === 0 &&
        rows.every(
          (row) => row.status === 206 && row.firstBytes > 0 && !row.error,
        ),
    };
  } finally {
    gate.setDownloadRate(0);
    await artifact().evaluate(async () => {
      const probe = window.__yaPressure;
      if (!probe) return;
      for (const controller of probe.controllers) controller.abort();
      await Promise.allSettled(probe.readers.map((reader) => reader.cancel()));
      delete window.__yaPressure;
    });
  }
}
