import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";

type ExecFileCallback = (
  error: Error | null,
  stdout?: string,
  stderr?: string,
) => void;

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    execFile: execFileMock,
  };
});

describe("Git execution", () => {
  it("preserves captured output on command failures", async () => {
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => {
        callback(new Error("git failed"), "partial output", "fatal detail");
        return { stdin: new PassThrough() };
      },
    );
    const { runGit } = await import("../../src/git/gitExec.js");
    await expect(runGit("/project", ["status"])).rejects.toMatchObject({
      stdout: "partial output",
      stderr: "fatal detail",
    });
  });
  it("passes NUL-delimited path input directly to Git stdin", async () => {
    const stdin = new PassThrough();
    const chunks: Buffer[] = [];
    stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => {
        stdin.on("finish", () => callback(null, "ignored\0", ""));
        return { stdin };
      },
    );
    const { runGit } = await import("../../src/git/gitExec.js");
    const input = "space name\0雪.txt\0";
    const result = await runGit("/project", ["check-ignore", "-z", "--stdin"], {
      input,
    });
    expect(Buffer.concat(chunks).toString()).toBe(input);
    expect(result.stdout).toBe("ignored\0");
  });
  afterEach(() => {
    execFileMock.mockReset();
    vi.resetModules();
  });

  it("disables optional locks for text and binary commands", async () => {
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => callback(null, "", ""),
    );
    const { buildGitProcessArgs, runGit, runGitBytes } = await import(
      "../../src/git/gitExec.js"
    );

    expect(buildGitProcessArgs(["clone", "source", "destination"])).toEqual([
      "--no-optional-locks",
      "clone",
      "source",
      "destination",
    ]);

    await runGit("/project", ["status", "--porcelain=v2"]);
    await runGitBytes("/project", ["show", "HEAD:file"]);

    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["--no-optional-locks", "-C", "/project", "status", "--porcelain=v2"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["--no-optional-locks", "-C", "/project", "show", "HEAD:file"],
      expect.any(Object),
      expect.any(Function),
    );
  });
});
