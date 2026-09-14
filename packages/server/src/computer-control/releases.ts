import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { extractComputerPackage, type ComputerPreview } from "./native.js";

const repository = "https://github.com/kzahel/machine-control";
// Trust comes from this shipped key, never a key or publisher asserted by a ZIP.
const publicKey = "RWQNyYvRPcz5QDF0wZvjQ2r1vyKB/m20XUDxXDEuLiFgH91XBGlm62ij";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const artifactSchema = z
  .object({
    target: z.enum(["win-x64", "win-arm64"]),
    file: z.string(),
    size: z
      .number()
      .int()
      .positive()
      .max(512 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const releaseSchema = z
  .object({
    schema: z.literal("machine-control-workstation-release/v1"),
    version: z.string().regex(versionPattern),
    tag: z.string(),
    protocol: z.literal("machine-control/v0"),
    consumerProtocol: z.literal(1),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    workflowRun: z.string().regex(/^\d+\.\d+$/),
    publisher: z.string().trim().min(1).max(256),
    artifacts: z.array(artifactSchema).length(2),
  })
  .strict();
export type ComputerRelease = z.infer<typeof releaseSchema>;
export interface ReleaseProgress {
  phase:
    | "checking"
    | "downloading"
    | "verifying"
    | "installing"
    | "ready"
    | "error";
  received?: number;
  total?: number;
}

export function compareVersions(left: string, right: string): number {
  if (!versionPattern.test(left) || !versionPattern.test(right))
    throw new Error("Invalid release version");
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return 1;
    if (a[i]! < b[i]!) return -1;
  }
  return 0;
}

/** Minisign ED framing; OpenSSL supplies BLAKE2b and Ed25519, not custom crypto.
 * Verify both signatures, including the trusted comment, before parsing JSON.
 * Format owner: https://github.com/jedisct1/minisign/blob/master/src/minisign.c
 */
export function verifyReleaseSignature(
  bytes: Buffer,
  signature: string,
  key = publicKey,
) {
  const lines = signature.trimEnd().split(/\r?\n/);
  const pk = Buffer.from(key, "base64");
  const sig = Buffer.from(lines[1] ?? "", "base64");
  const global = Buffer.from(lines[3] ?? "", "base64");
  if (
    lines.length !== 4 ||
    !lines[0]?.startsWith("untrusted comment: ") ||
    !lines[2]?.startsWith("trusted comment: ") ||
    pk.length !== 42 ||
    pk.subarray(0, 2).toString() !== "Ed" ||
    sig.length !== 74 ||
    sig.subarray(0, 2).toString() !== "ED" ||
    global.length !== 64 ||
    !sig.subarray(2, 10).equals(pk.subarray(2, 10))
  ) {
    throw new Error("Invalid Machine Control release signature");
  }
  const nativeKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      pk.subarray(10),
    ]),
    format: "der",
    type: "spki",
  });
  if (
    !verify(
      null,
      createHash("blake2b512").update(bytes).digest(),
      nativeKey,
      sig.subarray(10),
    ) ||
    !verify(
      null,
      Buffer.concat([sig.subarray(10), Buffer.from(lines[2].slice(17))]),
      nativeKey,
      global,
    )
  ) {
    throw new Error("Machine Control release signature verification failed");
  }
}

export function parseRelease(bytes: Buffer, tag: string): ComputerRelease {
  const parsed = releaseSchema.safeParse(JSON.parse(bytes.toString("utf8")));
  if (!parsed.success)
    throw new Error(
      "This Machine Control release is not compatible with this YA server. Update YA and try again.",
    );
  const release = parsed.data;
  if (
    release.tag !== tag ||
    tag !== `workstation-v${release.version}` ||
    new Set(release.artifacts.map((item) => item.target)).size !== 2 ||
    release.artifacts.some(
      (item) => item.file !== `machine-control-workstation-${item.target}.zip`,
    )
  ) {
    throw new Error("Release assets do not match the signed release identity");
  }
  return release;
}

async function response(url: string, signal: AbortSignal) {
  const result = await fetch(url, {
    signal,
    headers: { "User-Agent": "YepAnywhere-ComputerControl" },
  });
  if (!result.ok)
    throw new Error(
      result.status === 404
        ? "No published Computer Control package is available yet."
        : `Computer Control download failed (HTTP ${result.status}). Try again later.`,
    );
  if (!result.body) throw new Error("Empty release response");
  return result;
}
async function boundedBytes(url: string, limit: number, signal: AbortSignal) {
  const result = await response(url, signal);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of result.body!) {
    length += chunk.length;
    if (length > limit)
      throw new Error("Release metadata exceeds its size limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function discoverComputerRelease(
  signal: AbortSignal,
): Promise<ComputerRelease> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const metadata = JSON.parse(
    (
      await boundedBytes(
        "https://api.github.com/repos/kzahel/machine-control/releases/latest",
        256 * 1024,
        deadline,
      )
    ).toString("utf8"),
  ) as { tag_name?: string; draft?: boolean; prerelease?: boolean };
  if (
    metadata.draft ||
    metadata.prerelease ||
    !/^workstation-v\d+\.\d+\.\d+$/.test(metadata.tag_name ?? "")
  ) {
    throw new Error(
      "No compatible stable Computer Control release is available.",
    );
  }
  const base = `${repository}/releases/download/${metadata.tag_name}`;
  const [bytes, signature] = await Promise.all([
    boundedBytes(`${base}/release.json`, 65536, deadline),
    boundedBytes(`${base}/release.json.minisig`, 8192, deadline),
  ]);
  verifyReleaseSignature(bytes, signature.toString("utf8"));
  return parseRelease(bytes, metadata.tag_name!);
}

export async function stageComputerRelease(
  release: ComputerRelease,
  dataDirectory: string,
  signal: AbortSignal,
  progress: (value: ReleaseProgress) => void,
): Promise<{ preview: ComputerPreview; cleanup(): Promise<void> }> {
  const target =
    process.arch === "arm64"
      ? "win-arm64"
      : process.arch === "x64"
        ? "win-x64"
        : undefined;
  const artifact = release.artifacts.find((item) => item.target === target);
  if (!artifact)
    throw new Error("Computer Control requires Windows x64 or ARM64.");
  const staging = path.join(dataDirectory, "computer-control", "staging");
  await mkdir(staging, { recursive: true });
  const directory = await mkdtemp(path.join(staging, "release-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const archive = path.join(directory, "package.zip");
    const file = await open(archive, "wx");
    const hash = createHash("sha256");
    let received = 0;
    try {
      const result = await response(
        `${repository}/releases/download/${release.tag}/${artifact.file}`,
        AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
      );
      for await (const chunk of result.body!) {
        received += chunk.length;
        if (received > artifact.size)
          throw new Error("Package exceeds its signed size");
        hash.update(chunk);
        await file.writeFile(chunk);
        progress({ phase: "downloading", received, total: artifact.size });
      }
    } finally {
      await file.close();
    }
    progress({ phase: "verifying" });
    if (received !== artifact.size || hash.digest("hex") !== artifact.sha256) {
      throw new Error(
        "Downloaded package does not match the signed release. Retry the download.",
      );
    }
    signal.throwIfAborted();
    const packageDirectory = path.join(directory, "payload");
    await extractComputerPackage(archive, packageDirectory);
    signal.throwIfAborted();
    return {
      preview: { packageDirectory, trustedPublisher: release.publisher },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
