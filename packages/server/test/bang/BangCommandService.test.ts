/**
 * BangCommandService lifecycle: run/complete, previews, project-dir command
 * resolution, env scrubbing, truncation flags, kill, timeout, delete, and
 * restart recovery. Contract: topics/bang-commands.md.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Writable } from "node:stream";
import type { BangCommandTranscriptDisplayObject } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionMetadataService } from "../../src/metadata/SessionMetadataService.js";
import {
  BangCommandService,
  type BangCommandServiceOptions,
} from "../../src/services/BangCommandService.js";

const SESSION = "session-1";

let dataDir: string;
let projectDir: string;
let metadata: SessionMetadataService;
let events: Array<{ type: string; sessionId: string }>;

function createService(
  options: Partial<
    Pick<
      BangCommandServiceOptions,
      | "createOutputStream"
      | "maxActivePerSession"
      | "maxObjectsPerSession"
      | "loginStartupTimeoutMs"
      | "outputFileMaxBytes"
      | "timeoutMs"
    >
  > = {},
) {
  return new BangCommandService({
    dataDir,
    sessionMetadataService: metadata,
    eventBus: {
      emit: (event) => {
        events.push({ type: event.type, sessionId: event.sessionId });
      },
    },
    flushIntervalMs: 50,
    ...options,
  });
}

function bangObjects(): BangCommandTranscriptDisplayObject[] {
  return metadata
    .getTranscriptDisplayObjects(SESSION)
    .filter(
      (object): object is BangCommandTranscriptDisplayObject =>
        object.kind === "bang-command",
    );
}

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ya-bang-data-"));
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "ya-bang-proj-"));
  vi.stubEnv("HOME", dataDir);
  metadata = new SessionMetadataService({ dataDir });
  await metadata.initialize();
  events = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

describe("BangCommandService", () => {
  it("loads login functions and aliases while keeping the project cwd and PATH tail", async () => {
    vi.stubEnv("HOME", dataDir);
    await fs.writeFile(
      path.join(dataDir, ".bash_profile"),
      'bang_login_function() { printf "login-function\\n"; }\nalias bang_login_alias="bang_login_function"\nPATH=/usr/bin:/bin\ncd /\n',
    );
    await fs.writeFile(
      path.join(projectDir, "local-tool"),
      "#!/bin/sh\necho project-tool\n",
      { mode: 0o755 },
    );
    try {
      const { completion } = await createService().run({
        sessionId: SESSION,
        projectPath: projectDir,
        command: 'bang_login_alias; local-tool; printf "%s\\n" "$PWD"',
        placementAfterMessageId: "",
      });
      const final = await completion;
      expect(final.exitCode).toBe(0);
      expect(final.stderrPreview).toBeUndefined();
      expect(final.stdoutPreview).toBe(
        `login-function\nproject-tool\n${projectDir}\n`,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps login startup's own output out of the run", async () => {
    await fs.writeFile(
      path.join(dataDir, ".bash_profile"),
      "echo 'Welcome banner'\necho 'profile warning' >&2\n",
    );
    const service = createService();
    const { object, completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "echo out; echo err >&2",
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.status).toBe("done");
    expect(final.stdoutPreview).toBe("out\n");
    expect(final.stderrPreview).toBe("err\n");
    expect(final.stdoutBytes).toBe(4);
    const output = await service.readOutput(SESSION, object.id);
    expect(output.stdout).toBe("out\n");
    expect(output.stderr).toBe("err\n");
  });

  it("says the command never ran when login startup replaces the shell", async () => {
    // A profile ending in `exec zsh` switches shells; with no terminal the
    // new shell reads end of input and exits 0 before the command runs.
    await fs.writeFile(
      path.join(dataDir, ".bash_profile"),
      "echo 'switching shells'\nexec sh\n",
    );
    const marker = path.join(projectDir, "ran");
    const { completion } = await createService().run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: `touch ${marker}`,
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.status).toBe("error");
    expect(final.error).toMatch(/^Login startup did not return/);
    // Startup's output is the only evidence of what it did, so it stays.
    expect(final.stdoutPreview).toBe("switching shells\n");
    await expect(fs.access(marker)).rejects.toThrow();
  });

  it("stops a login startup that never returns", async () => {
    await fs.writeFile(path.join(dataDir, ".bash_profile"), "sleep 30\n");
    const startedAt = Date.now();
    const { completion } = await createService({
      loginStartupTimeoutMs: 300,
    }).run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "echo never",
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.status).toBe("killed");
    expect(final.error).toMatch(/^Login startup did not return within/);
    expect(final.stdoutPreview).toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it("runs a command and records exit, previews, and full output", async () => {
    const service = createService();
    const { object, completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "echo hello; echo oops 1>&2; exit 3",
      placementAfterMessageId: "msg-1",
    });
    expect(object.status).toBe("running");
    const final = await completion;
    expect(final.status).toBe("done");
    expect(final.exitCode).toBe(3);
    expect(final.stdoutPreview).toBe("hello\n");
    expect(final.stderrPreview).toBe("oops\n");
    expect(final.durationMs).toBeGreaterThanOrEqual(0);
    expect(final.cwd).toBe(projectDir);
    expect(final.placementAfterMessageId).toBe("msg-1");

    const output = await service.readOutput(SESSION, object.id);
    expect(output.stdout).toBe("hello\n");
    expect(output.stderr).toBe("oops\n");
    expect(output.responseTruncated).toBe(false);

    // Persisted in metadata and announced via metadata-changed events.
    expect(bangObjects().map((entry) => entry.id)).toContain(object.id);
    expect(
      events.filter((event) => event.type === "session-metadata-changed"),
    ).not.toHaveLength(0);
  });

  it("resolves bare names from the project directory (implicit PATH tail)", async () => {
    const toolPath = path.join(projectDir, "mytool");
    await fs.writeFile(toolPath, "#!/usr/bin/env bash\necho from-project\n");
    execSync(`chmod +x ${toolPath}`);
    const service = createService();
    const { completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "mytool",
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.exitCode).toBe(0);
    expect(final.stdoutPreview).toBe("from-project\n");
  });

  it("scrubs agent-session identity markers from the child env", async () => {
    vi.stubEnv("AGENTCTL_SESSION_ID", "leak-me");
    try {
      const service = createService();
      const { completion } = await service.run({
        sessionId: SESSION,
        projectPath: projectDir,
        command:
          'if [ -z "$AGENTCTL_SESSION_ID" ]; then echo scrubbed; else echo leaked; fi',
        placementAfterMessageId: "",
      });
      const final = await completion;
      expect(final.stdoutPreview).toBe("scrubbed\n");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("bounds the preview while keeping full output on disk", async () => {
    const service = createService();
    const { object, completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "seq 1 5000",
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.stdoutPreview?.length).toBeLessThanOrEqual(4096);
    expect(final.stdoutPreview?.endsWith("5000\n")).toBe(true);
    expect(final.stdoutBytes).toBeGreaterThan(4096);
    const output = await service.readOutput(SESSION, object.id);
    expect(output.stdout.startsWith("1\n2\n")).toBe(true);
  });

  it("caps each stored output stream at the documented byte limit", async () => {
    const service = createService();
    const { object, completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "head -c 8400000 /dev/zero",
      placementAfterMessageId: "",
    });
    const final = await completion;
    const outputStat = await fs.stat(
      service.outputPath(SESSION, object.id, "stdout"),
    );

    expect(outputStat.size).toBe(8 * 1024 * 1024);
    expect(final.stdoutTruncated).toBe(true);
  });

  it("rejects a fifth concurrent command in one session", async () => {
    const service = createService();
    const handles = [];
    try {
      for (let index = 0; index < 4; index += 1) {
        handles.push(
          await service.run({
            sessionId: SESSION,
            projectPath: projectDir,
            command: "sleep 30",
            placementAfterMessageId: "",
          }),
        );
      }

      await expect(
        service.run({
          sessionId: SESSION,
          projectPath: projectDir,
          command: "sleep 30",
          placementAfterMessageId: "",
        }),
      ).rejects.toThrow(/concurrent/i);
    } finally {
      for (const handle of handles) {
        service.kill(handle.object.id);
      }
      await Promise.all(handles.map((handle) => handle.completion));
    }
  });

  it("never prunes a running command to make room", async () => {
    const service = createService({
      maxActivePerSession: 2,
      maxObjectsPerSession: 1,
    });
    const first = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "sleep 30",
      placementAfterMessageId: "",
    });
    const second = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "sleep 30",
      placementAfterMessageId: "",
    });

    expect(bangObjects().map((entry) => entry.id)).toEqual([
      first.object.id,
      second.object.id,
    ]);

    service.kill(first.object.id);
    service.kill(second.object.id);
    await Promise.all([first.completion, second.completion]);
  });

  it("settles as an error when output storage fails", async () => {
    const service = createService({
      createOutputStream: () =>
        new Writable({
          write(_chunk, _encoding, callback) {
            callback(new Error("disk full"));
          },
        }),
    });
    const { completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "echo hello",
      placementAfterMessageId: "",
    });

    const final = await completion;
    expect(final.status).toBe("error");
    expect(final.error).toMatch(/storage failed.*disk full/);
  });

  it("records a terminal error when output setup fails synchronously", async () => {
    const service = createService({
      maxActivePerSession: 1,
      createOutputStream: () => {
        throw new Error("cannot create output file");
      },
    });

    await expect(
      service.run({
        sessionId: SESSION,
        projectPath: projectDir,
        command: "echo hello",
        placementAfterMessageId: "",
      }),
    ).rejects.toThrow(/cannot create output file/);
    expect(bangObjects()).toEqual([
      expect.objectContaining({
        status: "error",
        error: expect.stringMatching(/cannot create output file/),
      }),
    ]);
  });

  it("settles even when final metadata persistence fails", async () => {
    vi.spyOn(metadata, "updateTranscriptDisplayObject").mockRejectedValue(
      new Error("metadata disk full"),
    );
    const service = createService();
    const { completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "echo hello",
      placementAfterMessageId: "",
    });

    const final = await Promise.race([
      completion,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("completion stranded")), 1000);
      }),
    ]);
    expect(final.status).toBe("error");
    expect(final.error).toMatch(/Failed to persist.*metadata disk full/);
  });

  it("kills and settles running commands during disposal", async () => {
    const service = createService();
    const handle = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "sleep 30",
      placementAfterMessageId: "",
    });

    await service.dispose();

    await expect(handle.completion).resolves.toMatchObject({
      status: "killed",
      error: "Interrupted by server shutdown",
    });
    await expect(
      service.run({
        sessionId: SESSION,
        projectPath: projectDir,
        command: "true",
        placementAfterMessageId: "",
      }),
    ).rejects.toThrow(/shutting down/);
  });

  it("kills a running command's process group", async () => {
    const service = createService();
    const { object, completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "sleep 30",
      placementAfterMessageId: "",
    });
    expect(service.isRunning(object.id)).toBe(true);
    expect(service.kill(object.id)).toBe(true);
    const final = await completion;
    expect(final.status).toBe("killed");
    expect(final.error).toBe("Cancelled");
  });

  it("kills on timeout with a timeout reason", async () => {
    const service = createService({ timeoutMs: 300 });
    const { completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "sleep 30",
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.status).toBe("killed");
    expect(final.error).toMatch(/Timed out/);
  });

  it("refuses to remove a running command, removes a finished one", async () => {
    const service = createService();
    const running = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "sleep 30",
      placementAfterMessageId: "",
    });
    expect(await service.remove(SESSION, running.object.id)).toBe(false);
    service.kill(running.object.id);
    await running.completion;
    expect(await service.remove(SESSION, running.object.id)).toBe(true);
    expect(bangObjects()).toHaveLength(0);
    const output = await service.readOutput(SESSION, running.object.id);
    expect(output.stdout).toBe("");
  });

  it("marks running commands killed on restart recovery", async () => {
    await metadata.addTranscriptDisplayObject(SESSION, {
      id: "stale-run",
      kind: "bang-command",
      createdAt: new Date().toISOString(),
      placementAfterMessageId: "",
      command: "sleep 999",
      cwd: projectDir,
      status: "running",
    });
    const reloaded = new SessionMetadataService({ dataDir });
    await reloaded.initialize();
    const recovered = reloaded
      .getTranscriptDisplayObjects(SESSION)
      .find((object) => object.id === "stale-run");
    expect(recovered?.status).toBe("killed");
    expect(recovered?.error).toMatch(/restart/);
  });

  it("runs the harness-check acli fixture end to end", async () => {
    const fixtures = path.join(__dirname, "fixtures");
    for (const name of ["harness-check"]) {
      await fs.copyFile(path.join(fixtures, name), path.join(projectDir, name));
      execSync(`chmod +x ${path.join(projectDir, name)}`);
    }
    const service = createService();
    const { completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: `PATH="${path.join(fixtures, "bin")}:$PATH" harness-check --md --registry ${path.join(fixtures, "registry.json")} --harnesses claude,codex`,
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.exitCode).toBe(0);
    expect(final.stdoutPreview).toContain("## Harness updates");
    expect(final.stdoutPreview).toContain("update-available");
  });
});
