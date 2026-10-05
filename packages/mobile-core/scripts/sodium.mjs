import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export async function source(build) {
  // Upstream's -stable URL is mutable, including tar packaging metadata.
  // Keep the reviewed, signed distribution in Git rather than refreshing its
  // checksum whenever that URL is repacked. Validate before publishing it.
  const vendored = new URL(
    "../vendor/libsodium/libsodium-1.0.22-stable.tar.gz",
    import.meta.url,
  );
  const bytes = await readFile(vendored);
  const signature = await readFile(new URL(`${vendored.href}.minisig`));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (
    hash !== "25c47d0cbf804bf28f3a1166dc145ee013e31a8dc78bb0c9d74273fb44260567"
  ) {
    throw new Error(
      "Pinned libsodium source hash mismatch; review before changing the pin",
    );
  }
  const directory = join(build, "sodium-source");
  await mkdir(directory, { recursive: true });
  // Replace old cache entries too; both platforms must consume this revision.
  await writeFile(join(directory, "LATEST.tar.gz"), bytes);
  await writeFile(join(directory, "LATEST.tar.gz.minisig"), signature);
  // libsodium-sys-stable additionally verifies the upstream minisign signature.
  console.log("Pinned libsodium 1.0.22-stable archive verified");
}
