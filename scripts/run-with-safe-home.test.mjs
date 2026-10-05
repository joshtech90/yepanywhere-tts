import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const wrapper = fileURLToPath(
  new URL("./run-with-safe-home.js", import.meta.url),
);
const serverDirectory = fileURLToPath(
  new URL("../packages/server/", import.meta.url),
);

test("native Node arguments remain literal through the safe-home wrapper", () => {
  const argumentsToPreserve = [
    "with spaces",
    "literal & punctuation",
    'a"quoted"value',
  ];
  const result = spawnSync(
    process.execPath,
    [
      wrapper,
      "--temporary-home",
      process.execPath,
      "-e",
      "console.log(JSON.stringify(process.argv.slice(1)))",
      ...argumentsToPreserve,
    ],
    { cwd: serverDirectory, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), argumentsToPreserve);
  assert.equal(result.stderr, "");
});

for (const tool of ["vitest", "tsx"]) {
  test(`${tool} launches without a shell deprecation warning`, () => {
    const result = spawnSync(process.execPath, [wrapper, tool, "--version"], {
      cwd: serverDirectory,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(tool, "i"));
    assert.equal(result.stderr, "");
  });
}
