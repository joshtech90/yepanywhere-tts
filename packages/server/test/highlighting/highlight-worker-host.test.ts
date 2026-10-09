import { afterEach, describe, expect, it } from "vitest";
import {
  HighlightWorkerHost,
  HighlightWorkerUnavailableError,
} from "../../src/highlighting/highlight-worker-host.js";
import { runIdleSweeps } from "../../src/lib/processIdleSweep.js";

function inlineWorker(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

const SILENT_WORKER = inlineWorker(
  'import { parentPort } from "node:worker_threads"; parentPort.on("message", () => {});',
);
// Answers every job except one whose code is "hang".
const HANGING_WORKER = inlineWorker(
  'import { parentPort } from "node:worker_threads"; parentPort.on("message", ({ id, code }) => { if (code !== "hang") parentPort.postMessage({ id, html: code }); });',
);
const CRASHING_WORKER = inlineWorker(
  'import { parentPort } from "node:worker_threads"; parentPort.on("message", () => { throw new Error("boom"); });',
);

describe("HighlightWorkerHost", () => {
  const hosts: HighlightWorkerHost[] = [];
  function createHost(
    options: ConstructorParameters<typeof HighlightWorkerHost>[0],
  ): HighlightWorkerHost {
    const host = new HighlightWorkerHost(options);
    hosts.push(host);
    return host;
  }

  afterEach(async () => {
    await Promise.all(hosts.map((host) => host.close()));
    hosts.length = 0;
  });

  it("highlights with the code class and reports worker memory", async () => {
    const host = createHost({});
    const html = await host.highlight(
      "const x = 1;",
      "typescript",
      "language-typescript",
    );
    expect(html).toContain('<pre class="shiki css-variables"');
    expect(html).toContain('class="language-typescript"');
    expect(html).toContain("var(--shiki-");
    const stats = host.getStats();
    expect(stats).toMatchObject({ live: true, workersStarted: 1 });
    expect(stats.lastExternalBytes).toBeGreaterThan(0);
  });

  it("keeps the process alive only while a job runs", async () => {
    const countPorts = () =>
      process
        .getActiveResourcesInfo()
        .filter((resource) => resource === "MessagePort").length;
    const before = countPorts();
    const host = createHost({});
    const pending = host.highlight("const x = 1;", "typescript");
    expect(countPorts()).toBe(before + 1);
    await pending;
    expect(countPorts()).toBe(before);
  });

  it("rejects an unknown language without losing the worker", async () => {
    const host = createHost({});
    await expect(host.highlight("x", "not-a-language")).rejects.toThrow();
    await expect(host.highlight("x = 1", "python")).resolves.toContain("<span");
    expect(host.getStats()).toMatchObject({
      workersStarted: 1,
      workersFailed: 0,
    });
  });

  it("retires the worker at its job limit and continues the queue on a fresh one", async () => {
    const host = createHost({ maxJobs: 2 });
    const results = await Promise.all([
      host.highlight("a = 1", "python"),
      host.highlight("b = 2", "python"),
      host.highlight("c = 3", "python"),
    ]);
    for (const html of results) expect(html).toContain("<span");
    expect(host.getStats()).toMatchObject({
      live: true,
      jobsOnCurrentWorker: 1,
      workersStarted: 2,
      workersRetired: 1,
    });
  });

  it("retires the worker after the job that crosses the memory budget, not after its backlog", async () => {
    const host = createHost({ maxExternalBytes: 1 });
    await Promise.all([
      host.highlight("a = 1", "python"),
      host.highlight("b = 2", "python"),
      host.highlight("c = 3", "python"),
    ]);
    expect(host.getStats()).toMatchObject({
      live: false,
      workersStarted: 3,
      workersRetired: 3,
    });
  });

  it("retires an idle worker", async () => {
    const host = createHost({ idleMs: 60_000 });
    await host.highlight("a = 1", "python");
    runIdleSweeps(Date.now());
    expect(host.getStats().live).toBe(true);
    runIdleSweeps(Date.now() + 60_000);
    expect(host.getStats()).toMatchObject({ live: false, workersRetired: 1 });
  });

  it("rejects only the stalled job once the worker has proven it can run", async () => {
    // The stall limit also covers a cold worker's startup before its first
    // reply, so leave room for a loaded CI runner.
    const host = createHost({ stallMs: 2_000, workerUrl: HANGING_WORKER });
    const results = await Promise.allSettled([
      host.highlight("ok", "python"),
      host.highlight("hang", "python"),
      host.highlight("after", "python"),
    ]);
    expect(results[0]).toEqual({ status: "fulfilled", value: "ok" });
    expect(results[1]).toMatchObject({ status: "rejected" });
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
      HighlightWorkerUnavailableError,
    );
    expect(results[2]).toEqual({ status: "fulfilled", value: "after" });
    expect(host.getStats()).toMatchObject({
      workersStarted: 2,
      workersFailed: 1,
    });
  });

  it("fails the queue when a worker stalls before completing any job", async () => {
    const host = createHost({ stallMs: 50, workerUrl: SILENT_WORKER });
    const results = await Promise.allSettled([
      host.highlight("a", "python"),
      host.highlight("b", "python"),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(host.getStats()).toMatchObject({
      live: false,
      pendingJobs: 0,
      workersFailed: 1,
    });
  });

  it("rejects pending jobs when the worker crashes", async () => {
    const host = createHost({ workerUrl: CRASHING_WORKER });
    const result = host.highlight("a", "python");
    await expect(result).rejects.toThrow("boom");
    await expect(result).rejects.toBeInstanceOf(
      HighlightWorkerUnavailableError,
    );
    expect(host.getStats()).toMatchObject({ live: false, workersFailed: 1 });
  });
});
