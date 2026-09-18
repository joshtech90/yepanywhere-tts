import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/services/voice/localSttRuntime.js", async () => ({
  ...(await vi.importActual<
    typeof import("../../src/services/voice/localSttRuntime.js")
  >("../../src/services/voice/localSttRuntime.js")),
  ensureLocalSttRuntime: vi.fn(async () => ({ ok: true })),
}));
vi.mock("node:child_process", async () => ({
  ...(await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  )),
  spawn: spawnMock,
}));

import { LocalGraniteBackend } from "../../src/services/voice/localGraniteBackend.js";
import { LocalNemoBackend } from "../../src/services/voice/localNemoBackend.js";
import { LocalParakeetBackend } from "../../src/services/voice/localParakeetBackend.js";
import { LocalQwenBackend } from "../../src/services/voice/localQwenBackend.js";
import { LocalWhisperBackend } from "../../src/services/voice/localWhisperBackend.js";

afterEach(() => {
  spawnMock.mockReset();
  vi.unstubAllEnvs();
});

describe("local speech worker environment", () => {
  it("reloads Whisper on a GPU change only after active dictation finishes", async () => {
    const workers: Array<ReturnType<typeof makeWorker>> = [];
    function makeWorker() {
      const worker = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => {
          worker.emit("exit", 0);
          return true;
        }),
      });
      return worker;
    }
    spawnMock.mockImplementation(() => {
      const worker = makeWorker();
      workers.push(worker);
      queueMicrotask(() => worker.stdout.write('{"status":"ready"}\n'));
      return worker;
    });
    const backend = new LocalWhisperBackend();
    try {
      await backend.prewarm({ model: "custom-model" });
      const transcribing = backend.transcribe(Buffer.from("audio"), {
        model: "custom-model",
      });
      await vi.waitFor(() =>
        expect(workers[0]!.stdin.readableLength).toBeGreaterThan(0),
      );
      const switching = backend.setGpuEnabled(true);
      await Promise.resolve();
      expect(workers[0]!.kill).not.toHaveBeenCalled();
      workers[0]!.stdout.write('{"text":"dictation preserved"}\n');
      expect(await transcribing).toBe("dictation preserved");
      await switching;
      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock.mock.lastCall?.[1].slice(-3)).toEqual([
        "custom-model",
        "cuda",
        "int8",
      ]);
      await backend.setGpuEnabled(true);
      expect(spawnMock).toHaveBeenCalledTimes(2);
      await backend.setGpuEnabled(false);
      expect(spawnMock.mock.lastCall?.[1].slice(-3)).toEqual([
        "custom-model",
        "cpu",
        "int8",
      ]);
    } finally {
      for (const worker of workers) {
        worker.kill();
        worker.stdin.destroy();
        worker.stdout.destroy();
        worker.stderr.destroy();
      }
    }
  });
  it.each([
    ["Whisper", LocalWhisperBackend],
    ["Parakeet", LocalParakeetBackend],
    ["NeMo", LocalNemoBackend],
    ["Granite Speech", LocalGraniteBackend],
    ["Qwen3 ASR", LocalQwenBackend],
  ] as const)(
    "isolates %s runtime libraries while retaining operator settings",
    async (_name, Backend) => {
      vi.stubEnv("LD_LIBRARY_PATH", "/host/cuda/lib");
      vi.stubEnv("LD_PRELOAD", "/host/liboverride.so");
      vi.stubEnv("CUDA_VISIBLE_DEVICES", "1");
      vi.stubEnv("HF_HUB_CACHE", "/configured/model-cache");
      const worker = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      spawnMock.mockImplementation(() => {
        queueMicrotask(() => worker.stdout.write('{"status":"ready"}\n'));
        return worker;
      });

      try {
        await new Backend().prewarm();
        expect(spawnMock).toHaveBeenCalledOnce();
        if (Backend === LocalParakeetBackend) {
          expect(spawnMock.mock.lastCall?.[1]).toContain(
            "ai-and-i-project/parakeet-tdt-0.6b-v2-hf",
          );
        }
        if (Backend === LocalNemoBackend) {
          expect(spawnMock.mock.lastCall?.[1]).toContain(
            "nvidia/parakeet-unified-en-0.6b",
          );
        }
        const env = spawnMock.mock.lastCall?.[2].env;
        expect(env).toBeDefined();
        expect(env).not.toHaveProperty("LD_LIBRARY_PATH");
        expect(env).not.toHaveProperty("LD_PRELOAD");
        expect(env.CUDA_VISIBLE_DEVICES).toBe("1");
        expect(env.HF_HUB_CACHE).toBe("/configured/model-cache");
        expect(process.env.LD_LIBRARY_PATH).toBe("/host/cuda/lib");
        expect(process.env.LD_PRELOAD).toBe("/host/liboverride.so");
      } finally {
        worker.stdin.destroy();
        worker.stdout.destroy();
        worker.stderr.destroy();
      }
    },
  );

  it("forwards Granite keyterms on the worker request line", async () => {
    const chunks: string[] = [];
    const worker = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    worker.stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      worker.stdout.write('{"text":"ok"}\n');
    });
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => worker.stdout.write('{"status":"ready"}\n'));
      return worker;
    });
    try {
      const backend = new LocalGraniteBackend();
      await backend.prewarm();
      await backend.transcribe(Buffer.from("audio"), {
        keyterms: ["agentctl", "SQLite"],
      });
      const request = chunks
        .join("")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("{"));
      expect(request).toBeDefined();
      expect(JSON.parse(request ?? "{}")).toMatchObject({
        keyterms: ["agentctl", "SQLite"],
      });
    } finally {
      worker.stdin.destroy();
      worker.stdout.destroy();
      worker.stderr.destroy();
    }
  });
});
