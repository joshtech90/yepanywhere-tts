/** Explicit Mac/Windows appliance acceptance; the caller owns MC and all claims. */
import { strict as assert } from "node:assert";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, open, stat } from "node:fs/promises";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp, type AppResult } from "../src/app.js";
import { EventBus } from "../src/watcher/index.js";
import { CodexProvider } from "../src/sdk/providers/codex.js";
import {
  execute,
  verifyInstalledMachineControl,
} from "../src/machine-control/installation.js";
import type { Process } from "../src/supervisor/Process.js";
import type { ContentBlock, SDKMessage } from "../src/sdk/types.js";

assert(
  ["darwin", "win32"].includes(process.platform),
  "Dedicated Mac/Windows appliance only",
);
const windows = process.platform === "win32";
async function windowsProbe(code: string, input: object) {
  return execute(
    win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        "$ErrorActionPreference='Stop';$p=[Console]::In.ReadToEnd()|ConvertFrom-Json;" +
          code,
        "utf16le",
      ).toString("base64"),
    ],
    JSON.stringify(input),
  );
}
const root = process.env.MC_PROBE_ROOT!;
const claim = process.env.MACHINE_CONTROL_CLAIM_ID!;
assert(
  root &&
    claim &&
    process.env.YEP_MC_APP &&
    (windows ? process.env.YEP_MC_PUBLISHER : process.env.YEP_MC_TEAM_ID),
);
const info = await stat(root);
assert(info.isDirectory());
if (windows) {
  await windowsProbe(
    `
$acl=Get-Acl -LiteralPath $p.root;
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){throw 'Owned private staging ACL required'};
$allowed=@($sid,'S-1-5-18','S-1-5-32-544');
foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed){throw 'Unexpected staging reader'}};
`,
    { root },
  );
} else {
  assert((info.mode & 0o077) === 0 && info.uid === process.getuid?.());
}
const installed = await verifyInstalledMachineControl(
  process.env.YEP_MC_APP!,
  windows ? process.env.YEP_MC_PUBLISHER : process.env.YEP_MC_TEAM_ID,
);
if (windows)
  process.env.MACHINE_CONTROL_DESKTOP_INSTALL_DIR = win32.dirname(
    installed.root,
  );
const codexExecutable = windows
  ? join(
      root,
      "codex-runtime",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    )
  : join(root, "codex-runtime", "bin", "codex");
const cli = ["-I", "-B", join(installed.root, "launch.py"), "--target", "host"];
async function residentStatus() {
  const value = JSON.parse(
    await execute(installed.python, [
      ...cli,
      "--claim",
      claim,
      "desktop",
      windows ? "raw-local" : "raw",
      '{"operation":"status"}',
    ]),
  );
  assert(
    value.accepted &&
      typeof value.generation === "string" &&
      Number.isSafeInteger(value.data.processId),
  );
  process.kill(value.data.processId, 0);
  return {
    generation: value.generation as string,
    pid: value.data.processId as number,
  };
}
const before = await residentStatus();
async function assertResidentUnchanged() {
  assert.deepEqual(
    await residentStatus(),
    before,
    "YA lifecycle must not replace or stop MC",
  );
  const status = JSON.parse(
    await execute(installed.python, [...cli, "claim", "status"]),
  );
  assert(
    status.accepted &&
      status.data.state === "held" &&
      status.data.claim.claimId === claim,
  );
}
const crashChild = process.argv.includes("--crash-child");
let app: AppResult | undefined;
let session: Process | undefined;
function createProbeApp(suffix: string) {
  return createApp({
    provider: new CodexProvider({
      codexPath: codexExecutable,
      codexHome: join(root, "codex-profile"),
    }),
    eventBus: new EventBus(),
    dataDir: join(root, `ya-data-${suffix}`),
    projectsDir: join(root, "empty-claude"),
    codexSessionsDir: join(root, "codex-profile", "sessions"),
    geminiSessionsDir: join(root, "empty-gemini"),
    grokSessionsDir: join(root, "empty-grok"),
    piSessionsDir: join(root, "empty-pi"),
    enabledProviders: ["codex"],
    voiceInputEnabled: false,
    getLatestVersion: async () => null,
    authDisabled: true,
    sqliteMode: "off",
    codexSummaryParserWorkerMode: "off",
  });
}
async function closeApp() {
  const current = app;
  app = undefined;
  try {
    if (session && current) {
      const result = await current.supervisor.abortProcessWithVerification(
        session.id,
      );
      assert(result, "Supervisor must verify provider shutdown");
      assert(!current.supervisor.getProcessForSession(session.sessionId));
      session = undefined;
    }
  } finally {
    current?.stopNotifications();
    await current?.disposeSessionReaders();
  }
}
async function readInstalledWorkflow(suffix: string) {
  const cwd = join(root, `project-${suffix}`);
  await mkdir(cwd, { mode: 0o700 });
  const launched = await app!.supervisor.createSession(
    cwd,
    "bypassPermissions",
    {
      machineControl: true,
      providerName: "codex",
      effort: "low",
    },
  );
  assert("queueMessage" in launched);
  session = launched;
  const messages: SDKMessage[] = [];
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      unsubscribe = launched.subscribe((event) => {
        if (event.type !== "message") return;
        messages.push(event.message);
        if (event.message.type === "result") resolve();
        if (event.message.type === "error")
          reject(new Error("Provider reported an error"));
      });
      timer = setTimeout(
        () => reject(new Error("Bounded workflow turn timed out")),
        120_000,
      );
      launched.queueMessage({
        text: "This is a bounded installed-app lifecycle acceptance test. Execute two shell commands through the advertised exact installed Machine Control path: `agent instructions` and `agent identity`, both offline. Quote the executable path as required by your shell. Make no target operations or access requests, invoke no other commands, edit no files, and spawn no agents. Reply MC_PROTOCOL=<the numeric clientProtocol field observed in agent identity> and CLI_WORKFLOW=read.",
      });
    });
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
    const commands = JSON.stringify(calls);
    const instructionsRead = /agent[\s\\'",[\]]+instructions/.test(commands);
    const identityRead = /agent[\s\\'",[\]]+identity/.test(commands);
    assert(
      instructionsRead && identityRead,
      `Installed queries required: instructions=${instructionsRead}, identity=${identityRead}, tools=${calls.map((call) => call.name).join(",")}`,
    );
    const normalizePath = (value: string) => {
      const path = value.replaceAll("\\", "/");
      return windows ? path.replace(/\/+/g, "/").toLowerCase() : path;
    };
    const shellCalls = calls.filter((block) => block.name === "Bash");
    assert(
      shellCalls.length > 0 &&
        shellCalls.every((block) =>
          normalizePath(JSON.stringify(block.input ?? {})).includes(
            normalizePath(installed.command),
          ),
        ),
      `Verified command path required in shell calls: ${shellCalls.length}; observed executable paths: ${JSON.stringify(commands.match(/[A-Za-z]:[\\/][^"'{}\r\n]{0,1024}?machine-control\.cmd/g) ?? [])}`,
    );
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");
    assert(
      text.includes("MC_PROTOCOL=1") && text.includes("CLI_WORKFLOW=read"),
    );
    assert(Number.isSafeInteger(launched.pid), "Real provider PID required");
    process.kill(launched.pid!, 0);
    return launched;
  } finally {
    unsubscribe?.();
    if (timer) clearTimeout(timer);
  }
}

if (crashChild) {
  try {
    app = createProbeApp("crash");
    const owned = await readInstalledWorkflow("crash");
    assert(process.send, "Crash child requires its owning IPC parent");
    process.send({ ready: true, providerPid: owned.pid });
    await new Promise<void>(() => {}); // Caller explicitly crashes this process.
  } finally {
    await closeApp();
  }
} else {
  let child: ReturnType<typeof spawn> | undefined;
  let ownedProviderPid: number | undefined;
  let exit:
    | Promise<{ code: number | null; signal: NodeJS.Signals | null }>
    | undefined;
  const log = await open(join(root, "ya-crash.log"), "wx", 0o600);
  const failures: unknown[] = [];
  async function cleanCrashProcesses() {
    if (child?.pid) {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exit;
    }
    if (ownedProviderPid === undefined) return;
    if (windows) {
      await windowsProbe(
        `
$processes=@(Get-CimInstance Win32_Process|Where-Object {($_.ProcessId -eq $p.pid -and $_.CommandLine -and $_.CommandLine.Contains($p.root)) -or ($_.ExecutablePath -and $_.ExecutablePath -eq $p.executable)});
foreach($owned in $processes){
  $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owned.ProcessId);
  if($current -and $current.CreationDate -eq $owned.CreationDate){Stop-Process -Id $owned.ProcessId -ErrorAction Stop};
};
$deadline=[DateTime]::UtcNow.AddSeconds(5);
do{$remaining=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath -eq $p.executable});if(-not $remaining.Count){break};Start-Sleep -Milliseconds 50}while([DateTime]::UtcNow -lt $deadline);
if($remaining.Count){throw 'Owned crashed Codex executable remains'};
`,
        { root, pid: ownedProviderPid, executable: codexExecutable },
      );
      return;
    }
    // Codex owns a group outside YA's group. Check its exact staging root
    // before cleanup so a reused group ID cannot kill unrelated processes.
    const members = execFileSync("/bin/ps", ["-axo", "pid=,pgid=,command="], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
      .filter((match) => match && Number(match[2]) === ownedProviderPid);
    assert(
      members.every((match) => match![3]!.includes(root)),
      "Crash cleanup group must remain owned",
    );
    if (members.length) {
      try {
        process.kill(-ownedProviderPid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      const deadline = Date.now() + 5_000;
      while (true) {
        const groups = execFileSync("/bin/ps", ["-axo", "pgid="], {
          encoding: "utf8",
        });
        if (
          !groups
            .split("\n")
            .some((group) => Number(group.trim()) === ownedProviderPid)
        )
          break;
        assert(Date.now() < deadline, "Owned crashed provider group must exit");
        await sleep(50);
      }
    }
  }
  try {
    app = createProbeApp("graceful");
    const owned = await readInstalledWorkflow("graceful");
    const previousSession = owned.sessionId;
    const result = await app.supervisor.abortProcessWithVerification(owned.id);
    assert(result && !app.supervisor.getProcessForSession(previousSession));
    session = undefined;
    await assertResidentUnchanged();
    console.log(
      "PASS real Supervisor session close preserves independent MC resident and claim",
    );
    await closeApp();
    await assertResidentUnchanged();
    app = createProbeApp("graceful");
    assert(!app.supervisor.getProcessForSession(previousSession));
    await assertResidentUnchanged();
    await closeApp();
    console.log(
      "PASS owned full YA app shutdown and fresh restart preserve MC",
    );

    child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--crash-child"],
      {
        detached: true,
        env: process.env,
        stdio: ["ignore", log.fd, log.fd, "ipc"],
      },
    );
    const spawned = child;
    exit = new Promise((resolve, reject) => {
      spawned.once("error", reject);
      spawned.once("exit", (code, signal) => resolve({ code, signal }));
    });
    void exit.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    let providerPid: number;
    try {
      providerPid = await Promise.race([
        new Promise<number>((resolve, reject) => {
          spawned.on("message", (value) => {
            const ready = value as { ready?: boolean; providerPid?: number };
            if (!ready.ready || !Number.isSafeInteger(ready.providerPid))
              return;
            resolve(ready.providerPid!);
          });
          timer = setTimeout(
            () => reject(new Error("Crash child readiness timed out")),
            150_000,
          );
        }),
        exit.then(() => {
          throw new Error("Crash child exited before readiness");
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    assert.notEqual(before.pid, providerPid);
    ownedProviderPid = providerPid;
    if (windows) {
      await windowsProbe(
        `
$owned=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.pid);
if(-not $owned -or -not $owned.CommandLine -or -not $owned.CommandLine.Contains($p.root)){throw 'Exact owned Windows provider required'};
`,
        { root, pid: providerPid },
      );
    } else {
      const group = execFileSync(
        "/bin/ps",
        ["-p", String(providerPid), "-o", "pgid="],
        { encoding: "utf8" },
      ).trim();
      assert.equal(
        Number(group),
        providerPid,
        "Codex owns a separate process group",
      );
      const command = execFileSync(
        "/bin/ps",
        ["-p", String(providerPid), "-o", "command="],
        { encoding: "utf8" },
      ).trim();
      assert(
        command.startsWith(codexExecutable + " "),
        "Exact owned provider executable required",
      );
    }
    spawned.kill("SIGKILL");
    const crashed = await exit;
    assert(
      windows
        ? crashed.code !== 0 || crashed.signal === "SIGKILL"
        : crashed.signal === "SIGKILL",
    );
    await assertResidentUnchanged();
    console.log(
      "PASS abrupt real YA process crash leaves independent MC resident and claim healthy",
    );
  } catch (error) {
    failures.push(error);
  } finally {
    for (const finish of [closeApp, cleanCrashProcesses, () => log.close()]) {
      try {
        await finish();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "YA lifecycle acceptance failed");
  console.log(
    "PASS owned YA providers and crash process group cleaned; MC lifecycle remains caller-owned",
  );
}
