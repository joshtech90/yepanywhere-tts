import {
  reclaimArtifactPreviewLeases,
  retainArtifactPreviewLease,
} from "../../src/lib/artifactPreviewLeaseCleanup";
import type { SourceTransport } from "../../src/lib/transport/types";

const owners = new Map<string, () => Promise<void>>();
function transport(source: string) {
  return {
    async fetch(path: string, init?: RequestInit) {
      const response = await fetch(`/cleanup-api${path}`, {
        ...init,
        headers: { "X-Probe-Source": source },
      });
      if (!response.ok)
        throw Object.assign(new Error("Cleanup API refused"), {
          status: response.status,
        });
      return response.json();
    },
  } as SourceTransport;
}
const probe = {
  async open(source: string, id: string) {
    const captured = transport(source);
    await reclaimArtifactPreviewLeases(source, captured);
    owners.set(
      id,
      await retainArtifactPreviewLease(
        source,
        "/artifact-previews",
        {
          id,
          entry: "index.html",
          expiresAt: Date.now() + 60000,
        },
        captured,
      ),
    );
  },
  async close(id: string) {
    await owners.get(id)?.();
    owners.delete(id);
  },
  reclaim(source: string) {
    return reclaimArtifactPreviewLeases(source, transport(source));
  },
};
declare global {
  interface Window {
    previewCleanupProbe: typeof probe;
  }
}
window.previewCleanupProbe = probe;
