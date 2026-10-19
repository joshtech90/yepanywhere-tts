import type { ArtifactPreviewLease } from "./managedArtifactViewer";
import type { SourceTransport } from "./transport/types";

const JOURNAL = "yep-artifact-preview-cleanup-v1";
const MAX_RECORDS = 128;
const MAX_JSON_CHARS = 128 * 1024;
function deadline() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  return { signal: controller.signal, close: () => clearTimeout(timer) };
}
interface Record {
  key: string;
  source: string;
  base: string;
  id: string;
  expiresAt: number;
}
function endpoint(row: Pick<Record, "base" | "id">) {
  return (
    typeof row.base === "string" &&
    row.base.length <= 2048 &&
    /^\/(?:sessions\/[^/?#\\]+\/)?artifact-previews$/.test(row.base) &&
    typeof row.id === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(row.id)
  );
}
function valid(value: unknown): value is Record {
  if (!value || typeof value !== "object") return false;
  const row = value as Record;
  return (
    typeof row.key === "string" &&
    /^[a-f0-9-]{36}$/.test(row.key) &&
    typeof row.source === "string" &&
    row.source.length <= 4096 &&
    endpoint(row) &&
    typeof row.expiresAt === "number" &&
    Number.isFinite(row.expiresAt)
  );
}
function available() {
  if (!navigator.locks?.request) return false;
  try {
    localStorage.getItem(JOURNAL);
    return true;
  } catch {
    return false;
  }
}
function read(): Record[] {
  const raw = localStorage.getItem(JOURNAL);
  if (!raw) return [];
  if (raw.length > MAX_JSON_CHARS)
    throw new Error("Preview cleanup journal exceeds its limit");
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  if (rows.length > MAX_RECORDS)
    throw new Error("Too many preview cleanup owners");
  return rows.filter((row) => valid(row) && row.expiresAt > Date.now());
}
async function update<T>(change: (rows: Record[]) => T): Promise<T> {
  const budget = deadline();
  try {
    return await navigator.locks.request(
      `${JOURNAL}:index`,
      { signal: budget.signal },
      () => {
        const rows = read();
        const result = change(rows);
        const raw = JSON.stringify(rows);
        if (rows.length > MAX_RECORDS || raw.length > MAX_JSON_CHARS)
          throw new Error("Preview cleanup journal is full");
        if (rows.length) localStorage.setItem(JOURNAL, raw);
        else localStorage.removeItem(JOURNAL);
        return result;
      },
    );
  } finally {
    budget.close();
  }
}
function forget(key: string) {
  return update((rows) => {
    const index = rows.findIndex((row) => row.key === key);
    if (index !== -1) rows.splice(index, 1);
  });
}
async function revoke(
  transport: SourceTransport,
  row: Pick<Record, "base" | "id">,
  signal?: AbortSignal,
) {
  const budget = signal ? undefined : deadline();
  try {
    await transport.fetch(`${row.base}/${encodeURIComponent(row.id)}`, {
      method: "DELETE",
      signal: signal ?? budget!.signal,
    });
    return true;
  } catch (error) {
    // An authoritative absence settles cleanup; connection/auth failures do not.
    return (
      error !== null &&
      typeof error === "object" &&
      "status" in error &&
      (error.status === 404 || error.status === 410)
    );
  } finally {
    budget?.close();
  }
}

/** Called only by the capability-gated viewer, using its captured source. */
export async function reclaimArtifactPreviewLeases(
  source: string,
  transport: SourceTransport,
) {
  if (!available()) return;
  const pending = await update((rows) =>
    rows.filter((row) => row.source === source),
  );
  const budget = deadline();
  // No heartbeat, tab timeout or background sweep. Busy live owners are skipped;
  // at most four bounded idempotent deletes run beside normal foreground work.
  try {
    for (let offset = 0; offset < pending.length; offset += 4) {
      if (budget.signal.aborted) break;
      await Promise.all(
        pending.slice(offset, offset + 4).map((row) =>
          navigator.locks.request(
            `${JOURNAL}:${row.key}`,
            { ifAvailable: true },
            async (lock) => {
              if (!lock) return;
              if (
                !(await update((rows) =>
                  rows.some((current) => current.key === row.key),
                ))
              )
                return;
              if (await revoke(transport, row, budget.signal))
                await forget(row.key);
            },
          ),
        ),
      );
    }
  } finally {
    budget.close();
  }
}

/** Keep one browser-owned lock until explicit cleanup or document termination. */
export async function retainArtifactPreviewLease(
  source: string,
  base: string,
  lease: ArtifactPreviewLease,
  transport: SourceTransport,
): Promise<() => Promise<void>> {
  const row: Record = {
    key: crypto.randomUUID(),
    source,
    base,
    id: lease.id,
    expiresAt: lease.expiresAt,
  };
  if (!valid(row)) {
    if (endpoint(row)) await revoke(transport, row);
    throw new Error("Invalid preview cleanup owner");
  }
  if (!available())
    return async () => {
      await revoke(transport, row);
    };
  let unlock!: () => void;
  const held = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  let started!: () => void;
  const locked = new Promise<void>((resolve) => {
    started = resolve;
  });
  const holding = Promise.resolve().then(() =>
    navigator.locks.request(`${JOURNAL}:${row.key}`, async () => {
      started();
      await held;
    }),
  );
  // Surface lock rejection rather than leaving admission waiting forever.
  try {
    await Promise.race([locked, holding]);
    await update((rows) => {
      rows.push(row);
    });
  } catch (error) {
    unlock();
    await holding.catch(() => {});
    await revoke(transport, row);
    throw error;
  }
  let released: Promise<void> | undefined;
  return () =>
    (released ??= (async () => {
      try {
        if (await revoke(transport, row)) await forget(row.key);
      } finally {
        // Failed deletes remain journaled for the next foreground admission.
        unlock();
        await holding;
      }
    })());
}
