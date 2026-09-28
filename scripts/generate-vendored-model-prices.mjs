/**
 * Regenerate YA's vendored per-model token price table from a pi checkout.
 *
 * Reads pi's generated provider model modules and keeps only each model's id
 * and its four per-class prices — the data YA prices usage with. Run it when
 * the prices should be refreshed, then record the new upstream revision and
 * the hashes it prints in
 * packages/shared/src/vendor/pi-model-prices/VENDORED.md.
 *
 *   node scripts/generate-vendored-model-prices.mjs ~/pi \
 *     packages/shared/src/vendor/pi-model-prices/prices.generated.ts
 *
 * The regex read is deliberate: importing pi's modules would pull its whole
 * dependency graph into this repo's tooling for four numbers per model. A
 * shape change upstream shows up as a provider whose model count drops, which
 * is why the count is printed per provider.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const piRoot = process.argv[2];
const outPath = process.argv[3];
if (!piRoot || !outPath) {
  console.error(
    "usage: generate-vendored-model-prices.mjs <pi-checkout> <output.ts>",
  );
  process.exit(2);
}
const providers = [
  "anthropic",
  "openai",
  "openai-codex",
  "google",
  "xai",
  "opencode",
];

const upstreamFile = (provider) =>
  `packages/ai/src/providers/${provider}.models.ts`;

const rows = [];
for (const provider of providers) {
  const file = path.join(piRoot, upstreamFile(provider));
  const source = fs.readFileSync(file, "utf-8");
  const entry =
    /id: "([^"]+)",[\s\S]*?cost: \{\s*input: ([\d.]+),\s*output: ([\d.]+),\s*cacheRead: ([\d.]+),\s*cacheWrite: ([\d.]+),\s*\}/g;
  let count = 0;
  for (const match of source.matchAll(entry)) {
    const [, id, input, output, cacheRead, cacheWrite] = match;
    rows.push({ provider, id, input, output, cacheRead, cacheWrite });
    count += 1;
  }
  console.error(`${provider}: ${count}`);
}

const byProvider = new Map();
for (const row of rows) {
  if (!byProvider.has(row.provider)) byProvider.set(row.provider, []);
  byProvider.get(row.provider).push(row);
}

let out = `/**
 * Per-model token prices, in US dollars per million tokens, vendored from pi.
 *
 * Generated — see VENDORED.md in this directory for the upstream revision and
 * how to regenerate. Do not edit by hand.
 */

export interface VendoredModelPrices {
  /** Fresh prompt tokens, \\$/M. */
  input: number;
  /** Output tokens, \\$/M. */
  output: number;
  /** Cache-read prompt tokens, \\$/M. */
  cacheRead: number;
  /** Cache-write prompt tokens, \\$/M. Zero where the provider does not bill it. */
  cacheWrite: number;
}

/** Keyed by the upstream provider's own model id. */
export const VENDORED_MODEL_PRICES: Readonly<
  Record<string, Readonly<Record<string, VendoredModelPrices>>>
> = {
`;
for (const [provider, list] of [...byProvider.entries()].sort()) {
  out += `  ${JSON.stringify(provider)}: {\n`;
  for (const row of list.sort((a, b) => a.id.localeCompare(b.id))) {
    out += `    ${JSON.stringify(row.id)}: { input: ${row.input}, output: ${row.output}, cacheRead: ${row.cacheRead}, cacheWrite: ${row.cacheWrite} },\n`;
  }
  out += "  },\n";
}
out += "} as const;\n";

fs.writeFileSync(outPath, out);

// Format with the repository's formatter so the file VENDORED.md hashes is the
// file that gets committed, and a rerun at the same revision leaves no diff.
const biome = spawnSync(
  process.execPath,
  [path.join(import.meta.dirname, "biome.cjs"), "format", "--write", outPath],
  { stdio: ["ignore", "ignore", "inherit"] },
);
if (biome.status !== 0) {
  console.error(`biome format failed for ${outPath}`);
  process.exit(1);
}

const sha256 = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const provider of providers) {
  console.error(
    `sha256 ${upstreamFile(provider)}: ${sha256(path.join(piRoot, upstreamFile(provider))).slice(0, 16)}`,
  );
}
console.error(`wrote ${rows.length} models to ${outPath}`);
console.error(`sha256 ${outPath}: ${sha256(outPath)}`);
