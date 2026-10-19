import assert from "node:assert/strict";

/** Real TCP faults below Rust's socket; WebView network emulation cannot do this. */
export async function qualifyNativeFaults({
  page,
  artifact,
  gate,
  record,
  appendUpdate,
  until,
  seed,
  images,
}) {
  const composer = page
    .locator("textarea.message-input, textarea[placeholder]")
    .first();
  const draft = await composer.inputValue();
  await artifact().evaluate(() => {
    const movie = document.querySelector("#local-movie");
    movie.pause();
    movie.removeAttribute("src");
    movie.load(); // Release playback's independent producer before the controlled cut.
  });
  await page.evaluate(() => {
    window.__yaFaultEdges = [];
    let previous;
    const sample = () => {
      const state =
        document
          .querySelector("[data-connection-status]")
          ?.getAttribute("data-connection-status") ?? "ready";
      if (previous === state) return;
      previous = state;
      window.__yaFaultEdges.push({ at: performance.now(), state });
      if (window.__yaFaultEdges.length > 128) window.__yaFaultEdges.shift();
    };
    window.__yaFaultObserver = new MutationObserver(sample);
    window.__yaFaultObserver.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-connection-status"],
    });
    sample();
  });
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const checks = [];
  try {
    // Pause after the first real chunk, then require an incomplete body to
    // fail across the cut. This also checks browser/worker buffering rather
    // than assuming the native receive window alone bounds the entire path.
    const head = await artifact().evaluate(async () => {
      const response = await fetch("media/movie.mp4?cut=1", {
        headers: { Range: "bytes=0-16777215" },
      });
      const reader = response.body.getReader();
      window.__yaFaultReader = reader;
      const first = await reader.read();
      return { status: response.status, firstBytes: first.value.length };
    });
    assert.equal(head.status, 206);
    record({ type: "media-socket-cut", ...head });
    gate.disconnect();
    const interrupted = await artifact().evaluate(async () => {
      let bytes = 0;
      try {
        for (;;) {
          const part = await window.__yaFaultReader.read();
          if (part.done) return { failed: false, bytes };
          bytes += part.value.length;
        }
      } catch {
        return { failed: true, bytes };
      } finally {
        delete window.__yaFaultReader;
      }
    });
    assert(
      interrupted.failed && interrupted.bytes + head.firstBytes < 16777216,
      "A cut response must fail rather than silently splice/replay",
    );
    checks.push({ name: "interrupted-media-body", ...interrupted });
    record({ type: "media-body-ended", ...interrupted });
    for (const fault of ["disconnect", "refuse", "silent"]) {
      const durationMs = 2000 + (random() % 3000);
      record({ type: "fault-start", fault, durationMs });
      if (fault === "disconnect") gate.disconnect();
      else gate.setMode(fault);
      const text = `Fault ${fault} recovery ${seed}`;
      appendUpdate(text);
      // Twenty real local assets queued while the native socket is unavailable
      // or stalled, then exact bytes through the restored same viewer.
      const pendingImages = artifact()
        .evaluate(
          async ({ images, fault }) => {
            const results = await Promise.all(
              images.map(async (image) => {
                const response = await fetch(`${image.path}?fault=${fault}`);
                if (!response.ok)
                  throw new Error(`Image under ${fault}: ${response.status}`);
                const bytes = await response.arrayBuffer();
                const hash = [
                  ...new Uint8Array(
                    await crypto.subtle.digest("SHA-256", bytes),
                  ),
                ]
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
                if (hash !== image.sha256)
                  throw new Error("Fault-recovered image bytes changed");
                return bytes.byteLength;
              }),
            );
            return {
              images: results.length,
              bytes: results.reduce((sum, n) => sum + n, 0),
            };
          },
          { images, fault },
        )
        .then(
          (value) => ({ value }),
          (error) => ({ error: String(error) }),
        );
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      gate.setMode("pass");
      record({ type: "fault-restored", fault });
      const wave = await pendingImages;
      assert(!wave.error, wave.error);
      assert.equal(wave.value.images, 20);
      record({ type: "twenty-images-recovered", fault, ...wave.value });
      await until(
        `native artifact after ${fault}`,
        async () => {
          return artifact()?.evaluate(async () => {
            try {
              const response = await fetch("data.json?recovery=1");
              return response.ok && (await response.json()).notes === 3;
            } catch {
              return false;
            }
          });
        },
        90000,
      );
      record({ type: "artifact-read-recovered", fault });
      const identity = await artifact().evaluate(
        () => (window.__yaFaultIdentity ??= Math.random()),
      );
      // Covering viewers intentionally freeze the transcript projection; see
      // gaps/covered-viewer-live-transcript.md. Park rather than replace it to
      // observe catch-up, then prove the same artifact document survived.
      await page
        .getByRole("button", { name: "Minimize file viewer", exact: true })
        .click();
      await page.getByText(text, { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(
        await page.getByText(text, { exact: true }).count(),
        1,
        "Recovered events must appear once",
      );
      await page
        .getByRole("button", { name: /^Restore file viewer:.*index\.html$/ })
        .click();
      assert.equal(
        await artifact().evaluate(() => window.__yaFaultIdentity),
        identity,
        "Parking must retain the artifact document",
      );
      record({ type: "transcript-and-viewer-recovered", fault });
      assert.equal(
        await composer.inputValue(),
        draft,
        "Recovery must retain the composer draft",
      );
      checks.push({
        name: `native-${fault}-recovery`,
        durationMs,
        draftRetained: true,
        updateCount: 1,
        images: wave.value.images,
      });
    }
    await artifact().evaluate(() => {
      const movie = document.querySelector("#local-movie");
      movie.src = "media/movie.mp4?after-network=1";
      movie.currentTime = 300;
    });
    await artifact().locator("#play-local-movie").click();
    await until("movie playback after network recovery", () =>
      artifact().evaluate(() => {
        const movie = document.querySelector("#local-movie");
        return (
          !movie.error &&
          !movie.paused &&
          !movie.seeking &&
          movie.currentTime > 300.15 &&
          movie.videoWidth === 640
        );
      }),
    );
    checks.push({ name: "movie-retry-after-fault", playing: true });
    return {
      seed,
      checks,
      edges: await page.evaluate(() => window.__yaFaultEdges),
      gate: gate.snapshot(),
    };
  } finally {
    gate.setMode("pass");
    await page
      .evaluate(() => window.__yaFaultObserver?.disconnect())
      .catch(() => {});
  }
}
