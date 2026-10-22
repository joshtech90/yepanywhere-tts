// biome-ignore lint/correctness/noUnusedVariables: MainActivity invokes this function after loading the asset.
async function downloadFile(u, fallbackName, maxBytes) {
  try {
    let b;
    if (u.startsWith("blob:")) {
      b = window.__yepBlobs?.get(u);
    } else {
      const response = await fetch(u, { credentials: "same-origin" });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const chunks = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw new Error("zu gross");
            chunks.push(value);
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
      }
      b = new Blob(chunks, {
        type:
          response.headers.get("Content-Type") || "application/octet-stream",
      });
    }
    if (!b) throw new Error("blob weg");
    if (b.size > maxBytes) throw new Error("zu gross");
    const d = await new Promise((ok, f) => {
      const l = new FileReader();
      l.onload = () => ok(l.result);
      l.onerror = f;
      l.readAsDataURL(b);
    });
    const name = window.__yepDownloadNamen?.get(u) || fallbackName;
    YepApp.postMessage(JSON.stringify({ name, daten: d }));
  } catch (e) {
    YepApp.postMessage(JSON.stringify({ fehler: String(e) }));
  }
}
