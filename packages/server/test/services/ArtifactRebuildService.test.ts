import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactRebuildService,
  parseArtifactRebuildDescriptor,
  type RebuildDescriptor,
} from "../../src/services/ArtifactRebuildService.js";

describe("artifact rebuild hooks", () => {
  let root: string;
  let artifact: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "artifact-rebuild-"));
    artifact = join(root, "report.html");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function descriptor(argv: string[], extra = "") {
    return `<!doctype html><!-- ya-artifact:v1 ${JSON.stringify({
      regenerate: {
        hook: "report-build",
        registrationVersion: 1,
        proposedRegistration: { cwd: root, argv, outputs: [artifact] },
      },
    })} --><h1>Report${extra}</h1>`;
  }

  /** The approval a user gives after being shown this descriptor. */
  function approval(shown: RebuildDescriptor) {
    return {
      registrationVersion: shown.registrationVersion,
      ...shown.proposedRegistration!,
    };
  }

  it("parses only a well-formed descriptor from a real comment", () => {
    expect(
      parseArtifactRebuildDescriptor(descriptor(["node", "-e", "1"])),
    ).toMatchObject({ hook: "report-build", registrationVersion: 1 });
    expect(
      parseArtifactRebuildDescriptor(
        '<!-- ya-artifact:v1 {"regenerate":{"hook":"../x","registrationVersion":1}} -->',
      ),
    ).toBeUndefined();
    expect(
      parseArtifactRebuildDescriptor("<!-- ya-artifact:v1 not json -->"),
    ).toBeUndefined();
    expect(
      parseArtifactRebuildDescriptor(
        '<!-- ya-artifact:v1 {"regenerate":{"hook":"h","registrationVersion":1,"proposedRegistration":{"cwd":"relative","argv":["x"]}}} -->',
      ),
    ).toBeUndefined();
  });

  it("refuses to run before approval and runs the approved command afterwards", async () => {
    const service = new ArtifactRebuildService(join(root, "state"));
    const script = join(root, "build.mjs");
    await writeFile(
      script,
      `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], process.argv[3]); console.log("built");`,
    );
    const html = descriptor([process.execPath, script, artifact, "rebuilt"]);
    await writeFile(artifact, html);
    const parsed = parseArtifactRebuildDescriptor(html)!;
    expect(await service.status(artifact, parsed)).toMatchObject({
      registered: false,
      matches: false,
    });
    await expect(service.run(artifact, parsed)).rejects.toThrow(/approve/);

    // An approval of a different proposal registers nothing.
    const other = parseArtifactRebuildDescriptor(
      descriptor([process.execPath, script, artifact, "other"]),
    )!;
    expect(
      await service.register(artifact, parsed, approval(other)),
    ).toBeUndefined();
    expect((await service.status(artifact, parsed)).registered).toBe(false);

    expect(
      await service.register(artifact, parsed, approval(parsed)),
    ).toMatchObject({
      registered: true,
      matches: true,
    });
    const result = await service.run(artifact, parsed);
    expect(result).toMatchObject({ ok: true, exitCode: 0, timedOut: false });
    expect(result.log).toContain("built");
    expect(await readFile(artifact, "utf8")).toBe("rebuilt");

    // The registry survives a fresh service instance.
    const reloaded = new ArtifactRebuildService(join(root, "state"));
    expect(await reloaded.status(artifact, parsed)).toMatchObject({
      registered: true,
      matches: true,
    });
    // A changed proposal no longer matches the approval.
    const changed = parseArtifactRebuildDescriptor(
      descriptor([process.execPath, script, artifact, "other"]),
    )!;
    expect(await reloaded.status(artifact, changed)).toMatchObject({
      registered: true,
      matches: false,
    });
    await expect(reloaded.run(artifact, changed)).rejects.toThrow(/approve/);
  });

  it("reports a failing command and bounds its runtime", async () => {
    const service = new ArtifactRebuildService(join(root, "state"));
    const failing = parseArtifactRebuildDescriptor(
      descriptor([
        process.execPath,
        "-e",
        "console.error('boom'); process.exit(3)",
      ]),
    )!;
    await service.register(artifact, failing, approval(failing));
    expect(await service.run(artifact, failing)).toMatchObject({
      ok: false,
      exitCode: 3,
    });
    const slow = parseArtifactRebuildDescriptor(
      `<!-- ya-artifact:v1 ${JSON.stringify({
        regenerate: {
          hook: "slow",
          registrationVersion: 1,
          proposedRegistration: {
            cwd: root,
            argv: [process.execPath, "-e", "setTimeout(() => {}, 60000)"],
            timeoutSeconds: 1,
          },
        },
      })} -->`,
    )!;
    await service.register(artifact, slow, approval(slow));
    const result = await service.run(artifact, slow);
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  }, 20000);

  it("runs the command without YA's control-plane credentials", async () => {
    const service = new ArtifactRebuildService(join(root, "state"));
    const probe = parseArtifactRebuildDescriptor(
      descriptor([
        process.execPath,
        "-e",
        "console.log('token=' + (process.env.YEP_PROVIDER_RUNTIME_TOKEN ?? 'absent'))",
      ]),
    )!;
    await service.register(artifact, probe, approval(probe));
    const previous = process.env.YEP_PROVIDER_RUNTIME_TOKEN;
    process.env.YEP_PROVIDER_RUNTIME_TOKEN = "host-secret";
    try {
      expect((await service.run(artifact, probe)).log).toContain(
        "token=absent",
      );
    } finally {
      if (previous === undefined) delete process.env.YEP_PROVIDER_RUNTIME_TOKEN;
      else process.env.YEP_PROVIDER_RUNTIME_TOKEN = previous;
    }
  });

  function slowDescriptor(hook: string, script: string) {
    return parseArtifactRebuildDescriptor(
      `<!-- ya-artifact:v1 ${JSON.stringify({
        regenerate: {
          hook,
          registrationVersion: 1,
          proposedRegistration: {
            cwd: root,
            argv: [process.execPath, "-e", script],
            timeoutSeconds: 1,
          },
        },
      })} -->`,
    )!;
  }

  it("stops the processes a timed-out command started, not only the command", async () => {
    const service = new ArtifactRebuildService(join(root, "state"));
    const late = join(root, "late.txt");
    // A producer such as `quarto` runs pandoc and LaTeX as its own children.
    const helper = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(late)}, "late"), 2500)`;
    const slow = slowDescriptor(
      "tree",
      `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(helper)}], { stdio: "ignore" }); setTimeout(() => {}, 60000)`,
    );
    await service.register(artifact, slow, approval(slow));
    const started = Date.now();
    expect(await service.run(artifact, slow)).toMatchObject({
      ok: false,
      timedOut: true,
    });
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, started + 4000 - Date.now())),
    );
    await expect(readFile(late, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 20000);

  it("finishes a timed-out run whose output a process outside its group still holds", async () => {
    const service = new ArtifactRebuildService(join(root, "state"), {
      killGraceMs: 200,
    });
    const pidFile = join(root, "escaped.pid");
    // Detached, the helper leads its own process group and keeps the
    // command's output pipes open after the command is gone.
    const helper = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 30000)`;
    const slow = slowDescriptor(
      "escaped",
      `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(helper)}], { stdio: "inherit", detached: true }); setTimeout(() => {}, 60000)`,
    );
    await service.register(artifact, slow, approval(slow));
    try {
      const started = Date.now();
      expect(await service.run(artifact, slow)).toMatchObject({
        ok: false,
        timedOut: true,
      });
      expect(Date.now() - started).toBeLessThan(10000);
      expect(service.isRunning(artifact, "escaped")).toBe(false);
    } finally {
      const pid = Number(await readFile(pidFile, "utf8").catch(() => ""));
      if (pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already stopped with the command's tree.
        }
      }
    }
  }, 20000);

  it("sets an unreadable registry aside and starts without registrations", async () => {
    const stateDir = join(root, "state");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "rebuild-hooks.json"), '{"torn": ');
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const service = new ArtifactRebuildService(stateDir);
      const parsed = parseArtifactRebuildDescriptor(
        descriptor([process.execPath, "-e", "1"]),
      )!;
      expect(await service.status(artifact, parsed)).toMatchObject({
        registered: false,
        matches: false,
      });
      const aside = (await readdir(stateDir)).filter((name) =>
        name.startsWith("rebuild-hooks.unreadable-"),
      );
      expect(aside).toHaveLength(1);
      expect(await readFile(join(stateDir, aside[0]!), "utf8")).toBe(
        '{"torn": ',
      );
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("[ArtifactRebuild] Unreadable registrations"),
        expect.anything(),
      );

      await service.register(artifact, parsed, approval(parsed));
      const reloaded = new ArtifactRebuildService(stateDir);
      expect(await reloaded.status(artifact, parsed)).toMatchObject({
        registered: true,
        matches: true,
      });
    } finally {
      logged.mockRestore();
    }
  });
});
