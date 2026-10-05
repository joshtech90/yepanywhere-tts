/** Signed installed-app acceptance. No provider or elevated command starts. */
import { mkdtemp, copyFile, cp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { strict as assert } from "node:assert";
import {
  startNativeSudoSession,
  verifyNativeSudo,
} from "../packages/server/src/sdk/providers/native-sudo.js";
import type {
  AgentSession,
  StartSessionOptions,
} from "../packages/server/src/sdk/providers/types.js";

const { values } = parseArgs({
  options: { app: { type: "string" }, "team-id": { type: "string" } },
});
assert(
  process.platform === "darwin" && values.app && values["team-id"],
  "macOS, --app and --team-id required",
);
const app = values.app;
const team = values["team-id"];
const resources = await verifyNativeSudo(app, team);
console.log(
  "PASS installed app and native pair publisher/integrity verification",
);
let launch: StartSessionOptions | undefined;
await startNativeSudoSession(
  "codex",
  { cwd: tmpdir(), permissionMode: "bypassPermissions" },
  async (options) => {
    launch = options;
    return {} as AgentSession;
  },
  {
    environment: {
      YEP_MC_SUDO_APP: app,
      YEP_MC_SUDO_TEAM_ID: team,
      PATH: "/usr/bin:/bin",
    },
  },
);
assert(launch?.globalInstructions?.includes(join(resources, "mc-sudo")));
assert(launch?.agentEnvironment?.PATH?.startsWith(resources));
console.log("PASS installed helper advertisement at actual launch boundary");
await assert.rejects(verifyNativeSudo(app, "ZZZZZZZZZZ"));
console.log("PASS wrong trusted publisher refusal");
const temporary = await mkdtemp(join(tmpdir(), "mc-native-sudo-integrity-"));
try {
  const candidate = join(temporary, "Candidate.app");
  await cp(app, candidate, { recursive: true });
  const helper = join(candidate, "Contents", "Resources", "mc-sudo-askpass");
  const stream = await open(helper, "a");
  await stream.write("invalid-signature-fixture");
  await stream.close();
  await assert.rejects(verifyNativeSudo(candidate, team));
  console.log("PASS modified native helper refusal");
  await copyFile(join(resources, "mc-sudo-askpass"), helper);
  await rm(helper);
  await assert.rejects(verifyNativeSudo(candidate, team));
  console.log("PASS incomplete native pair refusal");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
