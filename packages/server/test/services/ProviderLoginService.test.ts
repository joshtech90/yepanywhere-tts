import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderLoginLaunch } from "../../src/sdk/providers/types.js";
import {
  ProviderLoginError,
  ProviderLoginService,
  parseLoginOutput,
  stripTerminalControls,
} from "../../src/services/ProviderLoginService.js";

const CLAUDE_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b&state=abc";

// Mirrors `claude auth login` without a terminal: an OSC 8 hyperlink, then a
// prompt that reads the authorization code from stdin.
const FAKE_CLAUDE = `
process.stdout.write("Opening browser to sign in\\u2026\\n");
process.stdout.write("If the browser didn't open, visit: \\u001b]8;;${CLAUDE_URL}\\u0007${CLAUDE_URL}\\u001b]8;;\\u0007\\n");
process.stdout.write("Paste code here if prompted > ");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => process.exit(data.trim() === "good-code" ? 0 : 3));
`;

// Mirrors `codex login --device-auth`: colored link and one-time code, then
// a wait for the browser side to finish.
const FAKE_CODEX = `
process.stdout.write("1. Open this link\\n   \\u001b[94mhttps://auth.openai.com/codex/device\\u001b[0m\\n");
process.stdout.write("2. Enter this one-time code \\u001b[90m(expires in 15 minutes)\\u001b[0m\\n   \\u001b[94mIXHO-DHC63\\u001b[0m\\n");
setInterval(() => {}, 1000);
`;

async function waitFor<T>(read: () => T, done: (value: T) => boolean) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("ProviderLoginService", () => {
  let dir: string;
  let service: ProviderLoginService;

  const launchFor = (
    source: string,
    acceptsCode: boolean,
  ): ProviderLoginLaunch => {
    const script = join(dir, `fake-${acceptsCode ? "claude" : "codex"}.mjs`);
    writeFileSync(script, source);
    return {
      executable: process.execPath,
      env: process.env,
      relayedArgs: [script],
      terminalArgs: [script],
      acceptsCode,
    };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ya-provider-login-"));
    service = new ProviderLoginService();
  });

  afterEach(() => {
    service.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it("relays Claude's sign-in link and completes with the pasted code", async () => {
    const started = service.start("claude", launchFor(FAKE_CLAUDE, true));
    const waiting = await waitFor(
      () => service.get("claude"),
      (flow) => Boolean(flow?.output.includes("Paste code")),
    );
    expect(waiting?.url).toBe(CLAUDE_URL);
    expect(waiting?.userCode).toBeUndefined();
    expect(waiting?.output).not.toContain("\u001b");

    service.submitCode("claude", started.id, "good-code");
    const finished = await waitFor(
      () => service.get("claude"),
      (flow) => flow?.state !== "running",
    );
    expect(finished?.state).toBe("succeeded");
    expect(finished?.codeSubmitted).toBe(true);
  });

  it("reports a rejected code as a failed sign-in", async () => {
    const started = service.start("claude", launchFor(FAKE_CLAUDE, true));
    await waitFor(
      () => service.get("claude"),
      (flow) => Boolean(flow?.output.includes("Paste code")),
    );
    service.submitCode("claude", started.id, "wrong");
    const finished = await waitFor(
      () => service.get("claude"),
      (flow) => flow?.state !== "running",
    );
    expect(finished?.state).toBe("failed");
  });

  it("relays Codex's device link and code, and cancel stops the CLI", async () => {
    const started = service.start("codex", launchFor(FAKE_CODEX, false));
    const waiting = await waitFor(
      () => service.get("codex"),
      (flow) => Boolean(flow?.userCode),
    );
    expect(waiting?.url).toBe("https://auth.openai.com/codex/device");
    expect(waiting?.userCode).toBe("IXHO-DHC63");
    expect(() => service.submitCode("codex", started.id, "x")).toThrow(
      ProviderLoginError,
    );

    expect(service.cancel("codex", started.id)?.state).toBe("cancelled");
  });

  it("replaces a running flow when a new sign-in starts", async () => {
    const first = service.start("codex", launchFor(FAKE_CODEX, false));
    const second = service.start("codex", launchFor(FAKE_CODEX, false));
    expect(second.id).not.toBe(first.id);
    expect(service.get("codex")?.id).toBe(second.id);
    expect(() => service.submitCode("codex", first.id, "x")).toThrow(
      "No such sign-in",
    );
  });

  it("only offers a host terminal where one can be opened", () => {
    expect(
      new ProviderLoginService({ platform: "win32" }).supportsHostTerminal(),
    ).toBe(true);
    expect(
      new ProviderLoginService({ platform: "linux" }).supportsHostTerminal(),
    ).toBe(false);
  });

  it("opens a Windows console that stays open after the CLI exits", () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const windows = new ProviderLoginService({
      platform: "win32",
      spawn: (command, args) => {
        calls.push({ command, args });
        return { on: () => {}, unref: () => {} } as never;
      },
    });
    windows.openHostTerminal({
      executable: "C:\\Users\\me\\AppData\\Local\\bin\\claude.exe",
      env: {},
      relayedArgs: [],
      terminalArgs: ["auth", "login", "--claudeai"],
      acceptsCode: true,
    });
    expect(calls).toEqual([
      {
        command: "cmd.exe",
        args: [
          '/d /c start "Yep Anywhere sign-in" cmd.exe /k "C:\\Users\\me\\AppData\\Local\\bin\\claude.exe" auth login --claudeai',
        ],
      },
    ]);
  });
});

describe("login output parsing", () => {
  it("removes OSC hyperlinks and color sequences", () => {
    expect(
      stripTerminalControls(
        "a \u001b]8;;https://x\u0007link\u001b]8;;\u0007 \u001b[94mb\u001b[0m\r\n",
      ),
    ).toBe("a link b\n");
  });

  it("does not mistake lowercase URL identifiers for a device code", () => {
    expect(parseLoginOutput(`visit ${CLAUDE_URL}`)).toEqual({
      url: CLAUDE_URL,
    });
  });
});
