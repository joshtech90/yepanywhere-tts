import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GatewayService, ModelInfo } from "@yep-anywhere/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  piModelsJsonPath,
  syncPiModelExport,
} from "../../../src/sdk/providers/piModelExport.js";

const service = (overrides: Partial<GatewayService> = {}): GatewayService => ({
  id: "vllm",
  label: "",
  shortName: "",
  url: "http://127.0.0.1:8001",
  enabled: true,
  autoStop: false,
  autoStopAfterSeconds: 0,
  codexEnabled: true,
  codexWireApi: "responses",
  ...overrides,
});

const model: ModelInfo = {
  id: "qwen3.8-flash-next",
  name: "qwen3.8-flash-next",
  contextWindow: 208896,
  supportedEffortLevels: ["low", "medium", "xhigh"],
};

/** A registry the user maintains by hand, as observed on a real machine. */
const HAND_WRITTEN = {
  providers: {
    "vllm-local": {
      baseUrl: "http://127.0.0.1:8001/v1",
      api: "openai-completions",
      apiKey: "none",
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek", reasoning: true }],
    },
  },
};

let agentDir: string;

beforeEach(async () => {
  agentDir = await mkdtemp(join(tmpdir(), "ya-pi-models-"));
});

async function readRegistry(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(piModelsJsonPath(agentDir), "utf8"),
  ) as Record<string, unknown>;
}

describe("pi model registry export", () => {
  it("adds a ya- provider beside what the user wrote", async () => {
    await writeFile(
      piModelsJsonPath(agentDir),
      JSON.stringify(HAND_WRITTEN, null, 2),
    );

    await syncPiModelExport({
      services: [service({ maxOutputTokens: 32768 })],
      enabled: true,
      models: new Map([["vllm", [model]]]),
      agentDir,
    });

    const registry = (await readRegistry()).providers as Record<string, never>;
    expect(Object.keys(registry)).toEqual(["vllm-local", "ya-vllm"]);
    expect(registry["ya-vllm"]).toEqual({
      baseUrl: "http://127.0.0.1:8001/v1",
      api: "openai-completions",
      apiKey: "none",
      models: [
        {
          id: "qwen3.8-flash-next",
          // Where it runs, which is what tells two endpoints' copies of the
          // same model apart in pi's own picker.
          name: "qwen3.8-flash-next (127.0.0.1:8001)",
          // The same resolution that decides whether YA offers a thinking
          // level decides whether pi does.
          reasoning: true,
          contextWindow: 208896,
          maxTokens: 32768,
        },
      ],
    });
    // The user's own registry is recoverable from before YA first touched it.
    expect(
      JSON.parse(
        await readFile(`${piModelsJsonPath(agentDir)}.ya-backup`, "utf8"),
      ),
    ).toEqual(HAND_WRITTEN);
  });

  it("withdraws its providers when the export is switched off", async () => {
    const models = new Map([["vllm", [model]]]);
    await syncPiModelExport({
      services: [service()],
      enabled: true,
      models,
      agentDir,
    });
    await syncPiModelExport({
      services: [service()],
      enabled: false,
      models,
      agentDir,
    });

    expect((await readRegistry()).providers).toEqual({});
  });

  it("keeps what pi was already told when a catalog is not read yet", async () => {
    await syncPiModelExport({
      services: [service()],
      enabled: true,
      models: new Map([["vllm", [model]]]),
      agentDir,
    });
    // A restart re-exports before any endpoint has answered; emptying the
    // provider would take a working registry away from a terminal session.
    const second = await syncPiModelExport({
      services: [service()],
      enabled: true,
      models: new Map(),
      agentDir,
    });

    expect(second.changed).toBe(false);
    const registry = (await readRegistry()).providers as Record<
      string,
      { models: unknown[] }
    >;
    expect(registry["ya-vllm"]?.models).toHaveLength(1);
  });

  it("leaves a disabled service out", async () => {
    await syncPiModelExport({
      services: [service({ enabled: false })],
      enabled: true,
      models: new Map([["vllm", [model]]]),
      agentDir,
    });

    expect((await readRegistry()).providers).toEqual({});
  });
});
