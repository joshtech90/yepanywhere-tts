import { strict as assert } from "node:assert";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CodexProvider } from "../src/sdk/providers/codex.js";
import type { SDKMessage, ContentBlock } from "../src/sdk/types.js";

assert(process.platform === "darwin", "Dedicated Mac appliance only");
// Caller owns appliance lifecycle, signed app placement and exact claims.
// Stage a complete Codex vendor runtime, not only its main executable.
const root = process.env.MC_PROBE_ROOT!;
const statePath = process.env.MC_PROBE_FIXTURE_STATE!;
assert(
  root && statePath && process.env.MACHINE_CONTROL_CLAIM_ID,
  "MC_PROBE_ROOT, MC_PROBE_FIXTURE_STATE and a live host claim are required",
);
const rootStat = await stat(root);
assert(
  rootStat.isDirectory() && (rootStat.mode & 0o077) === 0,
  "Use an owned private staging directory, never an operator project",
);
assert(
  rootStat.uid === process.getuid?.(),
  "Staging directory must belong to the caller",
);
const before = JSON.parse(await readFile(statePath, "utf8"));
assert(
  before.schema === "machine-control-macos-fixture/v0" &&
    Number.isSafeInteger(before.count),
);
assert(Number.isSafeInteger(before.pid));
process.kill(before.pid, 0); // Refuse a stale oracle from an earlier fixture run.
const capturePath = join(root, "capture.png");
const provider = new CodexProvider({
  codexPath: join(root, "codex-runtime", "bin", "codex"),
  codexHome: join(root, "codex-profile"),
});
const messages: SDKMessage[] = [];
const session = await provider.startSession({
  cwd: root,
  machineControl: true,
  permissionMode: "bypassPermissions",
  effort: "low",
  initialMessage: {
    text: `This is a bounded native-control acceptance test inside a dedicated Mac appliance. Use only the advertised installed Machine Control command and your built-in agent view_image tool. Read agent instructions and agent identity. Select host, use the already acquired claim ${JSON.stringify(process.env.MACHINE_CONTROL_CLAIM_ID)} on every target operation; the harness owns its release, so do not acquire, renew or release claims, and operate only the AppKit fixture org.machine-control.fixture. Enumerate windows, snapshot the fixture, and press its Increment button exactly once using the semantic reference. Do not repeat an uncertain mutation. Capture only that fixture window, retrieve its bounded artifact into ${JSON.stringify(capturePath)}, and view that file with your built-in agent view_image tool. Do not request access, touch any other application, open an OS image-viewer application, invoke other shell commands, edit files other than the artifact destination, or spawn agents. Reply MC_PROTOCOL=<the clientProtocol number from agent identity> and CAPTURE_COUNT=<the count visibly shown in the capture>.`,
  },
});
let timer: ReturnType<typeof setTimeout>;
const timedOut = new Promise<never>((_, reject) => {
  timer = setTimeout(() => {
    reject(new Error("Bounded native provider probe timed out"));
    void session.abort();
  }, 300_000);
});
try {
  await Promise.race([
    timedOut,
    (async () => {
      for await (const message of session.iterator) {
        messages.push(message);
        assert(message.type !== "error", JSON.stringify(message.error));
        if (message.type === "result") break;
      }
    })(),
  ]);
  const blocks = messages.flatMap<ContentBlock>((message) =>
    typeof message.message?.content === "string"
      ? [{ type: "text", text: message.message.content }]
      : (message.message?.content ?? []),
  );
  const calls = [
    ...new Map(
      blocks
        .filter((block) => block.type === "tool_use")
        .map((block) => [block.id, block]),
    ).values(),
  ];
  assert(
    calls
      .filter((block) => block.name === "Bash")
      .every((block) =>
        JSON.stringify(block.input).includes(
          "/mc-cli/commands/machine-control",
        ),
      ),
    "Shell calls must use only the advertised installed CLI",
  );
  const commands = JSON.stringify(calls);
  for (const command of [
    "agent instructions",
    "agent identity",
    "desktop windows",
    "desktop snapshot",
    "desktop action",
    "desktop capture",
    "desktop artifact",
  ]) {
    assert(
      commands.includes(command),
      `Actual installed CLI call required: ${command}`,
    );
  }
  assert(
    calls.some(
      (block) =>
        block.name === "ViewImage" &&
        JSON.stringify(block.input).includes(capturePath),
    ),
    "Native image viewer must consume the new capture",
  );
  assert.equal(
    calls.filter((block) => {
      const input = JSON.stringify(block.input);
      return input.includes("desktop action") && !input.includes("--help");
    }).length,
    1,
    "Do not repeat an uncertain native mutation",
  );
  const after = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(
    after.count,
    before.count + 1,
    "Independent native fixture effect must be exactly one increment",
  );
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
  assert(
    text.includes("MC_PROTOCOL=1") &&
      text.includes(`CAPTURE_COUNT=${after.count}`),
    `Model must observe actual protocol and new count. Observed response: ${text.slice(-2000)}`,
  );
  const png = await readFile(capturePath);
  assert(
    (await stat(capturePath)).size < 8 * 1024 * 1024 &&
      png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  );
  console.log(
    "PASS real YA provider used signed installed CLI for native semantic effect and new capture consumption",
  );
} finally {
  clearTimeout(timer!);
  try {
    await session.abort();
  } finally {
    await writeFile(join(root, "messages.json"), JSON.stringify(messages), {
      mode: 0o600,
    });
  }
}
