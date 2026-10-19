// Opt-in integration check, shared by the real Alpine and Android PRoot runs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { basename, join } from "node:path";

function output(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  }).trim();
}

assert.equal(process.getuid(), 1000);
assert.equal(process.getgid(), 1000);
assert.equal(userInfo().username, "user");
assert.equal(userInfo().homedir, "/home/user");
assert.equal(homedir(), "/home/user");
assert.equal(hostname(), "ya-phone");
assert.equal(output("hostname", []), "ya-phone");
assert.equal(output("uname", ["-n"]), "ya-phone");
assert.equal(readFileSync("/etc/hostname", "utf8").trim(), "ya-phone");
assert.match(output("getent", ["hosts", "ya-phone"]), /\sya-phone(?:\s|$)/);
assert.equal(
  output("bash", ["-lc", 'printf "%s:%s" "$USER" "$HOME"']),
  "user:/home/user",
);
assert.equal(output("sudo", ["-n", "id", "-u"]), "0");
assert.equal(output("sudo", ["-n", "-iu", "root", "id", "-un"]), "root");
assert.equal(output("sudo", ["-n", "-u", "user", "id", "-u"]), "1000");
assert.match(output("sudo", ["-n", "apk", "--version"]), /apk-tools/);
output("sudo", ["-n", "visudo", "-c"]);

const directory = mkdtempSync("/home/user/.user-check-");
const rootFile = `/etc/${basename(directory)}`;
try {
  writeFileSync(join(directory, "witness"), "same persistent home\n", {
    mode: 0o600,
  });
  assert.equal(
    readFileSync(join("/home/host", basename(directory), "witness"), "utf8"),
    "same persistent home\n",
  );
  // Exercise an actual administrative write and its child environment, not
  // just sudo's version banner or a mocked privilege switch.
  output("sudo", [
    "-n",
    "sh",
    "-c",
    'printf "%s:%s" "$(id -u)" "$HOME" > "$1"',
    "check-user",
    rootFile,
  ]);
  assert.equal(readFileSync(rootFile, "utf8"), "0:/root");
} finally {
  output("sudo", ["-n", "rm", "-f", rootFile]);
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    user: "user",
    uid: 1000,
    home: homedir(),
    hostname: hostname(),
    sudoUid: 0,
    legacyHomeAlias: true,
  }),
);
