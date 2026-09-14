import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => ({
  ...(await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  )),
  spawn: spawnMock,
}));
import { LocalWhisperBackend } from "../../src/services/voice/localWhisperBackend.js";

class Worker extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  requests: { audio_b64: string; prompt: string }[] = [];
  kill = vi.fn(() => {
    this.emit("exit", 0);
    return true;
  });
  constructor() {
    super();
    this.stdin.on("data", (data: Buffer) =>
      this.requests.push(JSON.parse(data.toString())),
    );
  }
  ready() {
    this.stdout.write('{"status":"ready"}\n');
  }
  result(text: string) {
    this.stdout.write(`${JSON.stringify({ text })}\n`);
  }
}

const workers: Worker[] = [];
function mockWorkers() {
  spawnMock.mockImplementation(() => {
    const worker = new Worker();
    workers.push(worker);
    return worker;
  });
}
afterEach(() => {
  for (const worker of workers.splice(0)) worker.kill();
  spawnMock.mockReset();
});

describe("Whisper model selection", () => {
  it("loads the new default and preserves an explicit server override", async () => {
    mockWorkers();
    for (const [backend, model] of [
      [new LocalWhisperBackend(), "distil-large-v3.5"],
      [new LocalWhisperBackend({ model: "large-v3" }), "large-v3"],
    ] as const) {
      const warming = backend.prewarm();
      await vi.waitFor(() =>
        expect(spawnMock.mock.lastCall?.[1]).toContain(model),
      );
      workers.at(-1)!.ready();
      await warming;
    }
  });

  it("queues a model switch after transcription and reuses a warmed model", async () => {
    mockWorkers();
    const backend = new LocalWhisperBackend();
    const first = backend.transcribe(Buffer.from("one"), {
      model: "large-v3",
      prompt: "Before cursor",
    });
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]!.ready();
    await vi.waitFor(() => expect(workers[0]!.requests).toHaveLength(1));
    const warming = backend.prewarm({ model: "turbo" });
    const second = backend.transcribe(Buffer.from("two"), { model: "turbo" });
    await Promise.resolve();
    expect(workers[0]!.kill).not.toHaveBeenCalled();
    expect(workers[0]!.requests[0]!.prompt).toBe("Before cursor");
    workers[0]!.result("first");
    expect(await first).toBe("first");
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(workers[0]!.kill).toHaveBeenCalledOnce();
    expect(spawnMock.mock.lastCall?.[1]).toContain("turbo");
    workers[1]!.ready();
    await warming;
    await vi.waitFor(() => expect(workers[1]!.requests).toHaveLength(1));
    workers[1]!.result("second");
    expect(await second).toBe("second");
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("rejects early worker exit and allows a fresh load", async () => {
    mockWorkers();
    const backend = new LocalWhisperBackend();
    const failed = expect(backend.prewarm()).rejects.toThrow(
      "exited before loading",
    );
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]!.emit("exit", 1);
    await failed;
    const warming = backend.prewarm();
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[1]!.ready();
    await warming;
  });
});
