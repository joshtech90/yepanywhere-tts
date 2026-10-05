import { createHash, createPublicKey, verify } from "node:crypto";

/** Minisign ED framing; OpenSSL supplies BLAKE2b and Ed25519, not custom crypto.
 * Verify both signatures, including the trusted comment, before parsing JSON.
 * Format owner: https://github.com/jedisct1/minisign/blob/master/src/minisign.c
 */
export function verifyMachineControlSignature(
  bytes: Buffer,
  signature: string,
  key: string,
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
