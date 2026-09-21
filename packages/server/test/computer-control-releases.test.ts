import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  parseRelease,
  verifyReleaseSignature,
  type ComputerRelease,
  stageComputerRelease,
} from "../src/computer-control/releases.js";
import { ComputerControlService } from "../src/computer-control/service.js";
import { ServerSettingsService } from "../src/services/ServerSettingsService.js";
import * as native from "../src/computer-control/native.js";
import { fileURLToPath } from "node:url";

const release: ComputerRelease = {
  schema: "machine-control-workstation-release/v1",
  version: "0.2.0",
  tag: "workstation-v0.2.0",
  protocol: "machine-control/v0",
  consumerProtocol: 1,
  publisher: "Test publisher",
  sourceRevision: "a".repeat(40),
  workflowRun: "123.1",
  artifacts: ["win-x64", "win-arm64"].map((target) => ({
    target: target as "win-x64" | "win-arm64",
    file: `machine-control-workstation-${target}.zip`,
    size: 10,
    sha256: "b".repeat(64),
  })),
};
describe("signed release contract", () => {
  it("accepts an independent minisign 0.12 signature fixture", async () => {
    const base = new URL("./fixtures/computer-release/", import.meta.url);
    const [bytes, signature, key] = await Promise.all([
      readFile(new URL("message.txt", base)),
      readFile(new URL("message.txt.minisig", base), "utf8"),
      readFile(new URL("test.pub", base), "utf8"),
    ]);
    expect(() =>
      verifyReleaseSignature(bytes, signature, key.trim().split(/\r?\n/)[1]),
    ).not.toThrow();
  });
  it("authenticates both minisign signatures and rejects altered bytes, key and comment", () => {
    const pair = generateKeyPairSync("ed25519");
    const keyId = Buffer.alloc(8, 7);
    const rawKey = pair.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32);
    const key = Buffer.concat([Buffer.from("Ed"), keyId, rawKey]).toString(
      "base64",
    );
    const data = Buffer.from(JSON.stringify(release));
    const signature = sign(
      null,
      createHash("blake2b512").update(data).digest(),
      pair.privateKey,
    );
    const comment = "timestamp:12345";
    const text = `untrusted comment: test\n${Buffer.concat([Buffer.from("ED"), keyId, signature]).toString("base64")}\ntrusted comment: ${comment}\n${sign(null, Buffer.concat([signature, Buffer.from(comment)]), pair.privateKey).toString("base64")}\n`;
    expect(() => verifyReleaseSignature(data, text, key)).not.toThrow();
    expect(() =>
      verifyReleaseSignature(
        Buffer.concat([data, Buffer.from(" ")]),
        text,
        key,
      ),
    ).toThrow("verification failed");
    expect(() =>
      verifyReleaseSignature(
        data,
        text.replace("timestamp:12345", "timestamp:54321"),
        key,
      ),
    ).toThrow();
    expect(() => verifyReleaseSignature(data, text)).toThrow();
  });
  it("rejects incompatible, missing, duplicate and substituted assets", () => {
    expect(
      parseRelease(Buffer.from(JSON.stringify(release)), release.tag),
    ).toEqual(release);
    for (const value of [
      { ...release, consumerProtocol: 2 },
      { ...release, artifacts: [release.artifacts[0], release.artifacts[0]] },
      { ...release, artifacts: release.artifacts.slice(0, 1) },
      { ...release, tag: "workstation-v0.3.0" },
    ]) {
      expect(() =>
        parseRelease(Buffer.from(JSON.stringify(value)), release.tag),
      ).toThrow();
    }
    expect(compareVersions("0.10.0", "0.2.0")).toBe(1);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(() => compareVersions("0.2.0-beta", "0.2.0")).toThrow();
  });
});

describe("download and extraction boundaries", () => {
  let directory: string;
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("rejects corrupt, truncated and oversized packages before extraction", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ya-release-download-"));
    const extract = vi
      .spyOn(native, "extractComputerPackage")
      .mockResolvedValue(undefined);
    for (const data of [
      Buffer.alloc(10, 1),
      Buffer.alloc(5),
      Buffer.alloc(11),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(data)),
      );
      await expect(
        stageComputerRelease(
          release,
          directory,
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow();
    }
    expect(extract).not.toHaveBeenCalled();
  });
  it("extracts only after verifying the complete download", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ya-release-download-"));
    const data = Buffer.alloc(10, 1);
    const candidate = {
      ...release,
      artifacts: release.artifacts.map((artifact) => ({
        ...artifact,
        sha256: createHash("sha256").update(data).digest("hex"),
      })),
    };
    const extract = vi
      .spyOn(native, "extractComputerPackage")
      .mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(data)),
    );
    const staged = await stageComputerRelease(
      candidate,
      directory,
      new AbortController().signal,
      () => {},
    );
    expect(extract).toHaveBeenCalledOnce();
    expect(staged.preview.trustedPublisher).toBe(release.publisher);
    await staged.cleanup();
  });
  it("assembles a streamed package whose chunks arrive separately", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ya-release-download-"));
    const chunks = [Buffer.alloc(4, 1), Buffer.alloc(3, 2), Buffer.alloc(3, 3)];
    const data = Buffer.concat(chunks);
    const candidate = {
      ...release,
      artifacts: release.artifacts.map((artifact) => ({
        ...artifact,
        sha256: createHash("sha256").update(data).digest("hex"),
      })),
    };
    let staged: Buffer | undefined;
    const extract = vi
      .spyOn(native, "extractComputerPackage")
      .mockImplementation(async (archive) => {
        staged = await readFile(archive);
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk);
                controller.close();
              },
            }),
          ),
      ),
    );
    const result = await stageComputerRelease(
      candidate,
      directory,
      new AbortController().signal,
      () => {},
    );
    expect(extract).toHaveBeenCalledOnce();
    expect(staged).toEqual(data);
    await result.cleanup();
  });
  // Two PowerShell invocations, each loading System.IO.Compression: 3348ms and
  // 4051ms on the Windows runs that passed, against a 5000ms default that left
  // 1.2x of headroom and duly ran out. Budget is 4x the observed maximum,
  // which is that 5000ms limit rather than the fastest run that beat it.
  it.runIf(process.platform === "win32")(
    "native extraction rejects traversal and handles a valid ZIP",
    { timeout: 20_000 },
    async () => {
      directory = await mkdtemp(path.join(tmpdir(), "ya-release-zip-"));
      const fixtures = new URL("./fixtures/computer-release/", import.meta.url);
      await expect(
        native.extractComputerPackage(
          fileURLToPath(new URL("traversal.zip", fixtures)),
          path.join(directory, "bad"),
        ),
      ).rejects.toThrow("Unsafe archive member");
      await native.extractComputerPackage(
        fileURLToPath(new URL("valid.zip", fixtures)),
        path.join(directory, "good"),
      );
      expect(
        await readFile(path.join(directory, "good", "hello.txt"), "utf8"),
      ).toBe("fixture");
    },
  );
});

describe("managed installation lifecycle", () => {
  let service: ComputerControlService;
  let directory: string;
  afterEach(async () => {
    await service?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  async function setup(installed = false) {
    directory = await mkdtemp(path.join(tmpdir(), "ya-release-test-"));
    const settings = new ServerSettingsService({ dataDir: directory });
    await settings.initialize();
    const previous = {
      packageDirectory: "previous-package",
      trustedPublisher: "Test publisher",
    };
    if (installed)
      await settings.updateSettings({
        computerControl: {
          enabled: true,
          idleMs: 60000,
          grantMs: 1800000,
          releaseVersion: "0.1.0",
          autoUpdate: false,
          preview: previous,
        },
      });
    const cleanup = vi.fn(async () => {});
    const stop = vi.fn(async () => {});
    const manage = vi.fn(async () => ({ packageId: "b".repeat(64) }));
    const start = vi.fn(async () => ({
      generation: "g",
      owner: {
        sid: "sid",
        sessionId: 1,
        instance: "test",
        pipe: "test",
        artifactRoot: "test",
      },
      activity() {},
      stop,
    }));
    const stage = vi.fn<typeof stageComputerRelease>(async () => ({
      preview: {
        packageDirectory: "staged",
        trustedPublisher: "Test publisher",
      },
      cleanup,
    }));
    service = new ComputerControlService(settings, directory, {
      platform: "win32",
      discover: async () => release,
      stage,
      manage,
      start,
      installed: (preview) => ({ ...preview, packageDirectory: "installed" }),
    });
    return { settings, previous, stage, manage, start, stop, cleanup };
  }
  async function settle() {
    await vi.waitFor(() =>
      expect(service.status().release.working).toBe(false),
    );
  }
  it("enable downloads, health-checks, stops and persists installed identity", async () => {
    const { stage, start, stop, cleanup } = await setup();
    await service.setManagedEnabled(true);
    await settle();
    expect(stage).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(service.config()).toMatchObject({
      enabled: true,
      releaseVersion: "0.2.0",
      preview: { packageDirectory: "installed" },
    });
    expect(service.status().running).toBe(false);
  });
  it("failed startup restores the previous package without changing version", async () => {
    const { start, manage, previous } = await setup(true);
    start.mockRejectedValueOnce(new Error("desktop not ready"));
    service.requestRelease("update");
    await settle();
    expect(manage).toHaveBeenLastCalledWith(
      previous,
      service.instance,
      "Install",
    );
    expect(service.config().releaseVersion).toBe("0.1.0");
    expect(service.status().release.error).toContain("desktop not ready");
  });
  it("active session grants defer updates without revocation or download", async () => {
    const { stage } = await setup(true);
    const grant = service.select("selected", true, "codex")!;
    service.requestRelease("automatic");
    await settle();
    expect(stage).not.toHaveBeenCalled();
    expect(service.status().sessions).toHaveLength(1);
    expect(service.status().release.updateAvailable).toBe(true);
    await grant.close();
  });
  it("changing automatic-update policy preserves active grants", async () => {
    await setup(true);
    service.select("selected", true, "codex");
    await service.setAutoUpdate(true);
    expect(service.status().sessions).toHaveLength(1);
  });
  it("ignores an installed version a hand-edited settings file left unusable", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ya-release-settings-"));
    await writeFile(
      path.join(directory, "server-settings.json"),
      JSON.stringify({
        version: 2,
        settings: {
          computerControl: {
            enabled: true,
            idleMs: 60000,
            grantMs: 1800000,
            releaseVersion: "0.1",
            autoUpdate: true,
            preview: {
              packageDirectory: "previous-package",
              trustedPublisher: "Test publisher",
            },
          },
        },
      }),
    );
    const settings = new ServerSettingsService({ dataDir: directory });
    await settings.initialize();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    service = new ComputerControlService(settings, directory, {
      platform: "win32",
      discover: async () => release,
    });
    expect(service.config().releaseVersion).toBeUndefined();
    expect(service.status().release.installedVersion).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"0.1"'));
    service.requestRelease("check");
    await settle();
    expect(service.status().release.error).toBeUndefined();
    expect(service.status().release.updateAvailable).toBe(true);
  });
  it("disable cancels staging and never enables after cancellation", async () => {
    const { stage, manage } = await setup();
    stage.mockImplementationOnce(async (_release, _dir, signal) => {
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      );
      throw new Error("unreachable");
    });
    await service.setManagedEnabled(true);
    await vi.waitFor(() => expect(stage).toHaveBeenCalledOnce());
    await service.setManagedEnabled(false);
    expect(manage).not.toHaveBeenCalled();
    expect(service.config().enabled).toBe(false);
  });
});
