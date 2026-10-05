import { strict as assert } from "node:assert";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CodexProvider } from "../src/sdk/providers/codex.js";
import type { SDKMessage, ContentBlock } from "../src/sdk/types.js";

assert(process.platform === "darwin", "Dedicated Mac appliance only");
// Caller owns appliance lifecycle, signed app placement and exact claims.
// Stage a complete Codex vendor runtime, not only its main executable.
const root = process.env.MC_PROBE_ROOT!;
const fixtureUrl = process.env.MC_PROBE_BROWSER_URL!;
assert(
  root && fixtureUrl && process.env.MACHINE_CONTROL_CLAIM_ID,
  "MC_PROBE_ROOT, MC_PROBE_BROWSER_URL and a live host claim are required",
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
const url = new URL(fixtureUrl);
assert(
  url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname === "/agent",
);
async function oracle() {
  const response = await fetch(new URL("/agent/state", url), {
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok);
  const state = (await response.json()) as { schema: string; count: number };
  assert(
    state.schema === "machine-control-browser-agent-fixture/v0" &&
      Number.isSafeInteger(state.count),
  );
  return state;
}
const before = await oracle();
const capturePath = join(root, "browser-agent.png");
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
    text: `This is a bounded browser-control acceptance test inside a dedicated Mac appliance. Use only the advertised installed Machine Control command and your built-in agent view_image tool. Read agent instructions and agent identity. Select host and use the already acquired claim ${JSON.stringify(process.env.MACHINE_CONTROL_CLAIM_ID)} on every target operation; the harness owns its release, so do not acquire, renew or release claims. Operate only the already-open fixture tab whose URL is ${JSON.stringify(fixtureUrl)}. Enumerate tabs, snapshot that fixture and click its Increment browser count button exactly once using the semantic reference. Do not repeat an uncertain mutation. Capture only that tab, retrieve the unchanged returned artifact path into ${JSON.stringify(capturePath)}, and inspect that PNG with the built-in agent view_image tool. Do not request access, touch other tabs/applications, open an OS image viewer, invoke other shell commands, edit files other than the artifact destination, use raw CDP/evaluation or spawn agents. Reply MC_PROTOCOL=<the clientProtocol number from agent identity> and CAPTURE_COUNT=<the browser count visibly shown in the capture>.`,
  },
});
let timer: ReturnType<typeof setTimeout>;
const timedOut = new Promise<never>((_, reject) => {
  timer = setTimeout(() => {
    reject(new Error("Bounded browser provider probe timed out"));
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
    "browser tabs",
    "browser snapshot",
    "browser click",
    "browser capture",
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
      return input.includes("browser click") && !input.includes("--help");
    }).length,
    1,
    "Do not repeat an uncertain browser mutation",
  );
  const after = await oracle();
  assert.equal(
    after.count,
    before.count + 1,
    "Independent HTTP fixture effect must be exactly one increment",
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
    "PASS real YA provider used signed installed CLI for browser semantic effect and new capture consumption",
  );
} finally {
  clearTimeout(timer!);
  try {
    await session.abort();
  } finally {
    await writeFile(
      join(root, "browser-messages.json"),
      JSON.stringify(messages),
      {
        mode: 0o600,
      },
    );
  }
}
