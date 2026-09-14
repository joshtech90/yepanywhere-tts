// Deterministic distribution probe: production owner + real child shell/CLI.
// This fixture stays in the checkout; every runtime module comes from the
// supplied installed package or desktop resource directory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const serverDir = resolve(process.argv[2]);
const source = process.argv.includes("--source");
const root = source ? "src" : "dist";
const extension = source ? "ts" : "js";
const { startAgentSelfSession } = await import(
  pathToFileURL(
    resolve(serverDir, root, `sdk/providers/agent-self.${extension}`),
  ).href
);
const { MessageQueue } = await import(
  pathToFileURL(resolve(serverDir, root, `sdk/messageQueue.${extension}`)).href
);

function command(env) {
  const shell = process.platform === "win32" ? process.env.ComSpec : "/bin/sh";
  assert.ok(shell, "The Windows artifact probe requires ComSpec");
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      shell,
      process.platform === "win32"
        ? ["/d", "/s", "/c", "ya-agent self --json"]
        : ["-c", "ya-agent self --json"],
      {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10000,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolveResult(JSON.parse(stdout))
        : reject(new Error(`ya-agent failed (${code}): ${stdout} ${stderr}`)),
    );
  });
}

let report;
const session = await startAgentSelfSession(
  "claude",
  {
    cwd: serverDir,
    agentSelf: true,
    model: "scripted-alias",
    effort: "low",
  },
  async (options) => ({
    queue: new MessageQueue(),
    abort() {},
    iterator: (async function* () {
      yield {
        type: "system",
        subtype: "init",
        session_id: "artifact-self-session",
        model: "scripted-resolved-model",
      };
      const env = { ...process.env, ...options.agentEnvironment };
      delete env.AGENTCTL_SESSION_ID;
      delete env.BASH_ENV;
      delete env.YEP_ORIGINAL_BASH_ENV;
      // Deliberately exclude global Node/Bun discovery. The launcher must use
      // the absolute runtime belonging to the installed owner.
      env.PATH = options.agentEnvironment.PATH.split(
        process.platform === "win32" ? ";" : ":",
      )[0];
      report = await command(env);
      yield { type: "result", session_id: "artifact-self-session" };
    })(),
  }),
);
try {
  for await (const _message of session.iterator) {
    /* drain scripted provider */
  }
  assert.equal(report.sessionId, "artifact-self-session");
  assert.equal(report.launch.model.value, "scripted-alias");
  assert.equal(report.selected.effort.value, "low");
  assert.equal(report.providerEvidence.model.value, "scripted-resolved-model");
  assert.equal(report.providerEvidence.effort.status, "unknown");
  assert.equal(report.activeInference, "unknown");
  console.log(
    `ya-agent self artifact smoke passed (${process.versions.bun ? "private Bun" : "Node"}, ${source ? "source" : "compiled"}).`,
  );
} catch (error) {
  // Keep deterministic fixture failures visible in public check annotations
  // as well as the authenticated Actions log viewer.
  if (process.env.GITHUB_ACTIONS === "true") {
    const message = String(error.stack ?? error)
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    console.error(`::error::${message}`);
  }
  throw error;
} finally {
  await session.abort();
}
