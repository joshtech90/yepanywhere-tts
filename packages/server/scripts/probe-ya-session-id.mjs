// Paid end-to-end probe for plan 150 step 4: a new Claude session keeps the
// id YA minted from creation through restart, resume, CLI resume, fork and
// clone. Runs the built server (packages/server/dist) on a throwaway profile:
// a temporary YA data directory and a temporary CLAUDE_CONFIG_DIR, so no real
// sessions or YA state are touched. Uses short Haiku turns.
//
// Usage, after `pnpm --filter @yep-anywhere/server build`:
//   node packages/server/scripts/probe-ya-session-id.mjs
//   PROBE_EXECUTOR=localhost node packages/server/scripts/probe-ya-session-id.mjs
//   PROBE_ROUTER_POOL=<pool-id> node packages/server/scripts/probe-ya-session-id.mjs
//
// PROBE_EXECUTOR runs the session through that SSH host alias. PROBE_ROUTER_POOL
// pairs the throwaway YA with the local Agent Auth Router; grant the new
// integration that pool when prompted (the probe waits). The probe disconnects,
// which revokes the integration, when it finishes.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(serverDir, "dist", "index.js");
const model = process.env.PROBE_MODEL ?? "haiku";
const executor = process.env.PROBE_EXECUTOR;
const routerPool = process.env.PROBE_ROUTER_POOL;

const root = await mkdtemp(join(tmpdir(), "ya-session-id-e2e-"));
const dataDir = join(root, "data");
// Executor sync-back ignores CLAUDE_CONFIG_DIR and writes to ~/.claude, so
// executor runs use the default directory with a throwaway project folder.
const claudeDir = executor ? join(homedir(), ".claude") : join(root, "claude");
const project = join(root, "project");
await mkdir(project, { recursive: true });
await mkdir(claudeDir, { recursive: true });
const projectPath = await realpath(project);
const projectId = Buffer.from(projectPath).toString("base64url");
const transcriptDir = join(
  claudeDir,
  "projects",
  projectPath.replace(/[^a-zA-Z0-9]/g, "-"),
);

const results = [];
function record(check, pass, detail = "") {
  results.push({ check, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${check}${detail ? ` — ${detail}` : ""}`,
  );
}

let server;
let base;
let output = "";
async function startServer() {
  const portFile = join(root, `port-${Date.now()}`);
  server = spawn(process.execPath, [entry], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      YEP_DATA_DIR: dataDir,
      CLAUDE_CONFIG_DIR: claudeDir,
      AUTH_DISABLED: "true",
      ENABLED_PROVIDERS: "claude",
      VOICE_INPUT: "false",
      SERVE_FRONTEND: "false",
      YEP_PROVIDER_HOST_ENABLED: "false",
      HOST: "127.0.0.1",
      PORT: "0",
      PORT_FILE: portFile,
      MAINTENANCE_PORT: "0",
      OPEN_BROWSER: "false",
    },
  });
  const collect = (chunk) => {
    output = (output + chunk).slice(-200_000);
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  const deadline = Date.now() + 60_000;
  while (!existsSync(portFile) || !readFileSync(portFile, "utf8").trim()) {
    assert.ok(server.exitCode === null, `server exited\n${output}`);
    assert.ok(Date.now() < deadline, `server did not start\n${output}`);
    await delay(100);
  }
  base = `http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}`;
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill("SIGTERM");
  await Promise.race([exited, delay(30_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function api(method, path, body) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Yep-Anywhere": "true" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${path} → ${response.status}: ${text.slice(0, 400)}`,
    );
  }
  return json;
}

function transcripts() {
  return existsSync(transcriptDir)
    ? readdirSync(transcriptDir).filter((name) => name.endsWith(".jsonl"))
    : [];
}

function assistantTexts(sessionId) {
  const file = join(transcriptDir, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === "assistant")
    .flatMap((entry) =>
      (entry.message?.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text),
    );
}

async function waitForReply(sessionId, before, pattern) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const texts = assistantTexts(sessionId);
    const fresh = texts.slice(before).join(" ");
    if (texts.length > before && pattern.test(fresh)) return fresh;
    await delay(500);
  }
  throw new Error(`no reply matching ${pattern} in ${sessionId}\n${output}`);
}

async function waitIdle(sessionId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const detail = await api(
      "GET",
      `/projects/${projectId}/sessions/${sessionId}`,
    );
    const state =
      detail.ownership?.owner === "self" ? detail.processState : "idle";
    if (state !== "in-turn") return;
    await delay(500);
  }
}

try {
  await startServer();
  console.log(`root=${root}\nserver=${base}\n`);

  const launch = {
    provider: "claude",
    model,
    mode: "default",
    ...(executor ? { executor } : {}),
  };

  if (routerPool) {
    const connected = await api("POST", "/agent-auth-router/connect", {});
    console.log(
      `Paired with router ${connected.routerId ?? JSON.stringify(connected)}.\n` +
        `Grant the new integration pool ${routerPool} now, for example with aar owner grants/save. Waiting up to 5 minutes...`,
    );
    const deadline = Date.now() + 300_000;
    let pool;
    for (;;) {
      const status = await api("POST", "/agent-auth-router/overview", {}).catch(
        () => undefined,
      );
      pool = status?.pools?.find((candidate) => candidate.id === routerPool);
      if (pool) break;
      assert.ok(Date.now() < deadline, "router pool was not granted");
      await delay(2000);
    }
    // Automatic policies need fresh usage evidence; refresh as Settings would.
    for (const accountId of pool.accountIds ?? []) {
      await api("POST", "/agent-auth-router/overview/refresh", {
        accountId,
        poolId: routerPool,
        model,
      }).catch((error) =>
        console.log(`refresh ${accountId}: ${error.message}`),
      );
    }
    Object.assign(launch, { routerPoolId: routerPool });
  }

  // 1. Start a new session.
  const started = await api("POST", `/projects/${projectId}/sessions`, {
    message: "Remember the code word PLUM. Reply with just OK.",
    ...launch,
  });
  const sessionId = started.sessionId;
  await waitForReply(sessionId, 0, /ok/i);
  await waitIdle(sessionId);
  record(
    "start response id is the transcript id",
    transcripts().length === 1 && transcripts()[0] === `${sessionId}.jsonl`,
    `${sessionId} files=${transcripts().join(",")}`,
  );
  // The init log proves server logs reach this output, so absence means something.
  const received = /Session ID received from SDK/.test(output);
  const remapped = /session_id_mapping_updated/.test(output);
  record(
    "no provisional-id remap was logged",
    received && !remapped,
    `init logged=${received} remap logged=${remapped}`,
  );
  if (routerPool) {
    const detail = await api(
      "GET",
      `/projects/${projectId}/sessions/${sessionId}`,
    );
    const binding = detail.session?.routerBinding;
    record(
      "routed session carries its binding under the same id",
      Boolean(binding?.id),
      binding
        ? `binding ${binding.id} account ${binding.accountId}`
        : "no binding",
    );
  }

  // 2. Restart the server and resume.
  await stopServer();
  await startServer();
  const beforeResume = assistantTexts(sessionId).length;
  // Resume responses carry no session id; the reply must land in this file.
  await api("POST", `/projects/${projectId}/sessions/${sessionId}/resume`, {
    message: "What is the code word? Reply with just the word.",
    ...launch,
    ...(routerPool ? { routerPoolId: undefined } : {}),
  });
  const resumeReply = await waitForReply(sessionId, beforeResume, /plum/i);
  await waitIdle(sessionId);
  record(
    "resume after restart keeps the id, file and context",
    transcripts().length === 1,
    `reply=${resumeReply.trim().slice(0, 40)} files=${transcripts().join(",")}`,
  );

  // 3. CLI resume (local sessions only).
  if (!executor && !routerPool) {
    const cli = await run(
      "claude",
      [
        "--resume",
        sessionId,
        "-p",
        "Repeat the code word only.",
        "--model",
        model,
      ],
      {
        cwd: projectPath,
        env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
        timeout: 120_000,
      },
    ).catch((error) => ({ stdout: `${error.message}\n${error.stdout ?? ""}` }));
    record(
      "CLI resume continues the YA session",
      /plum/i.test(cli.stdout) && transcripts().length === 1,
      cli.stdout.trim().slice(0, 60),
    );
  }

  // 4. Clone through the menu path (/fork) and the aside path (/clone, which
  // copies Claude transcripts itself). Routed copies get their own binding.
  const parentBinding = routerPool
    ? (await api("GET", `/projects/${projectId}/sessions/${sessionId}`)).session
        ?.routerBinding
    : undefined;
  for (const [label, path, body] of [
    ["menu Clone", "fork", { forkKind: "clone-latest-complete" }],
    ["aside /clone", "clone", {}],
  ]) {
    const clone = await api(
      "POST",
      `/projects/${projectId}/sessions/${sessionId}/${path}`,
      body,
    ).catch((error) => ({ error: error.message }));
    record(
      `${label} creates a child transcript`,
      Boolean(clone.sessionId) &&
        transcripts().includes(`${clone.sessionId}.jsonl`),
      clone.error?.slice(0, 200) ?? clone.sessionId,
    );
    if (!clone.sessionId) continue;
    if (routerPool) {
      const binding = (
        await api("GET", `/projects/${projectId}/sessions/${clone.sessionId}`)
      ).session?.routerBinding;
      record(
        `${label} child has its own binding for the same account`,
        Boolean(binding?.id) &&
          binding.id !== parentBinding?.id &&
          binding.accountId === parentBinding?.accountId,
        `child ${binding?.id} parent ${parentBinding?.id} account ${binding?.accountId}`,
      );
    }
    const beforeChild = assistantTexts(clone.sessionId).length;
    await api(
      "POST",
      `/projects/${projectId}/sessions/${clone.sessionId}/resume`,
      {
        message: "What is the code word? Reply with just the word.",
        ...launch,
        ...(routerPool ? { routerPoolId: undefined } : {}),
      },
    );
    const childReply = await waitForReply(
      clone.sessionId,
      beforeChild,
      /plum/i,
    );
    record(
      `${label} child keeps the parent's context`,
      true,
      childReply.trim().slice(0, 40),
    );
    await waitIdle(clone.sessionId);
  }
  if (routerPool) {
    const after = (
      await api("GET", `/projects/${projectId}/sessions/${sessionId}`)
    ).session?.routerBinding;
    record(
      "parent keeps its own binding",
      after?.id === parentBinding?.id,
      after?.id,
    );
  }
} catch (error) {
  record(
    "probe completed",
    false,
    error instanceof Error ? error.message.slice(0, 600) : String(error),
  );
} finally {
  // Keep the server's recent output for diagnosis; the profile itself is removed.
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(join(tmpdir(), "probe-ya-session-id-server.log"), output),
  );
  if (routerPool && server?.exitCode === null) {
    // Disconnecting revokes this throwaway integration in the router.
    await api("POST", "/agent-auth-router/disconnect", {}).catch((error) =>
      console.log(`router disconnect failed: ${error.message}`),
    );
  }
  await stopServer();
  if (executor) {
    // The remote writes under its own ~/.claude; remove this probe's project.
    const slug = transcriptDir.split("/").at(-1);
    await run("ssh", [
      "-o",
      "BatchMode=yes",
      executor,
      `rm -rf ~/.claude/projects/${slug}`,
    ]).catch((error) => console.log(`remote cleanup failed: ${error.message}`));
  }
  if (executor) await rm(transcriptDir, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
process.exitCode = failed.length ? 1 : 0;
