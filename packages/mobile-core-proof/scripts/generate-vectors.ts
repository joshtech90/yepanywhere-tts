import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createFixture } from "../../../scripts/android-secure-interop-fixture.js";

// Small private values are deliberately insecure public fixtures: they force
// short integer encodings and never enter a real authentication connection.
const edge = await createFixture({
  password: "pässword 🔐",
  salt: 1n,
  clientPrivate: 1n,
  serverPrivate: 2n,
});
let minimalProof: Awaited<ReturnType<typeof createFixture>> | undefined;
for (let candidate = 1n; candidate <= 2048n; candidate++) {
  const fixture = await createFixture({
    salt: 1n,
    clientPrivate: 1n,
    serverPrivate: candidate,
  });
  if (fixture.srp.M1.length <= 126) {
    minimalProof = fixture;
    break;
  }
}
if (!minimalProof) throw new Error("No minimal-M1 fixture found");

for (const [name, fixture] of [
  ["minimal-public-unicode", edge],
  ["minimal-m1", minimalProof],
] as const) {
  const path = fileURLToPath(
    new URL(`../test-vectors/${name}.json`, import.meta.url),
  );
  const expected = `${JSON.stringify(fixture, null, 2)}\n`;
  if (process.argv.includes("--write")) await writeFile(path, expected);
  else if ((await readFile(path, "utf8")) !== expected) {
    throw new Error(`Stale Rust proof fixture: ${name}`);
  }
}
console.log("Rust edge vectors match production TypeScript crypto");
