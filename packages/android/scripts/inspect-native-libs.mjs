import { execFileSync } from "node:child_process";
// Check packaged bytes, not just compiler flags. Android's 16 KiB requirement
// covers every ELF load segment; keep this portable across controller hosts.
const apk = process.argv[2];
if (!apk) throw new Error("Expected APK path");
const entries = execFileSync("unzip", ["-Z1", apk], { encoding: "utf8" })
  .trim()
  .split("\n");
for (const entry of entries.filter((entry) => /^lib\/.*\.so$/.test(entry))) {
  const bytes = execFileSync("unzip", ["-p", apk, entry], {
    maxBuffer: 64 * 1024 * 1024,
  });
  if (bytes.readUInt32BE(0) !== 0x7f454c46 || bytes[5] !== 1)
    throw new Error(`Unexpected ELF header: ${entry}`);
  const wide = bytes[4] === 2;
  const offset = wide
    ? Number(bytes.readBigUInt64LE(32))
    : bytes.readUInt32LE(28);
  const size = bytes.readUInt16LE(wide ? 54 : 42);
  const count = bytes.readUInt16LE(wide ? 56 : 44);
  for (let index = 0; index < count; index++) {
    const header = offset + size * index;
    if (bytes.readUInt32LE(header) !== 1) continue;
    const alignment = wide
      ? Number(bytes.readBigUInt64LE(header + 48))
      : bytes.readUInt32LE(header + 28);
    if (alignment < 16384)
      throw new Error(`ELF load segment lacks 16 KiB alignment: ${entry}`);
  }
}
console.log("Packaged Android native libraries have 16 KiB ELF alignment.");
