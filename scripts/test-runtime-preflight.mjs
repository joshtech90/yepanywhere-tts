import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = resolve(process.argv[2] ?? "dist/npm-package");
const manifest = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8"),
);
assert.equal(manifest.engines.node, "^22.16 || ^23.11 || >=24.10");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(npm_config_|pnpm_|node_options$)/i.test(key),
  ),
);
const rejectActualRuntime = process.argv.includes("--reject");
const temporary = mkdtempSync(join(tmpdir(), "ya-runtime-preflight-"));
try {
  // Exercise complete public entry points. A rejection must precede dependency
  // loading, provider coordination, logging and all data-directory writes.
  for (const entry of ["cli.js", "index.js"]) {
    for (const [kind, version] of rejectActualRuntime
      ? [
          [
            process.versions.bun ? "bun" : "node",
            process.versions.bun ?? process.versions.node,
          ],
        ]
      : [
          ["node", "20.12.2"],
          ["node", "22.15.0"],
          ["node", "23.10.0"],
          ["node", "24.9.0"],
          ["bun", "1.3.13"],
        ]) {
      const url = pathToFileURL(join(packageDir, "dist", entry)).href;
      const code = rejectActualRuntime
        ? `await import(${JSON.stringify(url)});`
        : `Object.defineProperty(process, 'versions', {value: {...process.versions, node: '24.20.0', bun: undefined, [${JSON.stringify(kind)}]: ${JSON.stringify(version)}}}); await import(${JSON.stringify(url)});`;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", code],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: { ...environment, YEP_DATA_DIR: join(temporary, "data") },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Error: Yep Anywhere requires/);
      assert.ok(result.stderr.includes(version), result.stderr);
      assert.doesNotMatch(
        result.stderr,
        /ExperimentalWarning|ERR_MODULE|SQLite|Codex/,
      );
      assert.equal(result.stdout, "");
      assert.equal(existsSync(join(temporary, "data")), false);
    }
  }
  if (!rejectActualRuntime) {
    for (const flag of ["--help", "-h", "--version", "-v"]) {
      const info = spawnSync(
        process.execPath,
        [join(packageDir, "dist/cli.js"), flag],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: { ...environment, YEP_DATA_DIR: join(temporary, "data") },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      assert.equal(info.status, 0, info.stderr);
      if (flag === "--help" || flag === "-h") {
        assert.match(info.stdout, /bunx --bun yepanywhere/);
      } else {
        assert.equal(info.stdout.trim(), `yepanywhere v${manifest.version}`);
      }
      assert.equal(info.stderr, "");
      assert.equal(existsSync(join(temporary, "data")), false);
    }
  }
  console.log("Packaged CLI and direct-server runtime preflight passed");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
