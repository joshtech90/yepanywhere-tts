import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../../src/git/gitExec.js";

describe("runGit locale", () => {
  const previous = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
  let dir: string | undefined;

  afterEach(async () => {
    for (const key of ["LANG", "LC_ALL"] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reports Git failures in English on a German system", async () => {
    // Callers match "not a git repository"; a translated message broke them.
    process.env.LANG = "de_DE.UTF-8";
    process.env.LC_ALL = "de_DE.UTF-8";
    dir = await mkdtemp(join(tmpdir(), "ya-git-locale-"));

    const failure = await runGit(dir, ["rev-parse", "--show-toplevel"]).then(
      () => null,
      (error: { stderr?: string }) => error,
    );

    expect(String(failure?.stderr).toLowerCase()).toContain(
      "not a git repository",
    );
  });

  it("keeps English messages when a caller passes its own locale", async () => {
    dir = await mkdtemp(join(tmpdir(), "ya-git-locale-"));

    const failure = await runGit(dir, ["rev-parse", "--show-toplevel"], {
      env: { LC_ALL: "de_DE.UTF-8", LANGUAGE: "de" },
    }).then(
      () => null,
      (error: { stderr?: string }) => error,
    );

    expect(String(failure?.stderr).toLowerCase()).toContain(
      "not a git repository",
    );
  });
});
