import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeProvider } from "../../../src/sdk/providers/claude.js";
import {
  prepareSessionSandbox,
  probeSessionSandboxAvailability,
} from "../../../src/session-sandbox.js";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", async (original) => ({
  ...(await original<object>()),
  query,
}));

const scratch = await mkdtemp(join(tmpdir(), "ya-claude-sandbox-"));
afterAll(() => rm(scratch, { recursive: true }));
const hostSandboxAvailable =
  (
    await probeSessionSandboxAvailability({
      stateRoot: join(scratch, "probe-state"),
    })
  ).state === "available";

function collectStdout(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve(stdout)
        : reject(
            new Error(`sandboxed shell failed ${code}/${signal}: ${stderr}`),
          ),
    );
  });
}

// Real Bubblewrap launches; see session-sandbox.test.ts for the budget.
describe("Claude sandboxed launch", { timeout: 20_000 }, () => {
  const t = hostSandboxAvailable ? it : it.skip;
  let caseIndex = 0;

  afterEach(() => {
    vi.unstubAllEnvs();
    query.mockReset();
  });

  async function prepare(
    instructions?: import("@yep-anywhere/shared").ResolvedLimitedUserInstructions,
  ) {
    const root = join(scratch, `case-${caseIndex++}`);
    const projectPath = join(root, "project");
    const claudeHome = join(root, "claude-home");
    await mkdir(projectPath, { recursive: true });
    await mkdir(claudeHome);
    // Bootstrap the private provider state from an empty home.
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);
    vi.stubEnv("BASH_ENV", undefined);
    vi.stubEnv("AGENTCTL_SESSION_ID", undefined);
    const sessionSandbox = await prepareSessionSandbox({
      level: "project-write",
      provider: "claude",
      projectPath,
      stateRoot: join(root, "state"),
      instructions,
    });
    if (!sessionSandbox) throw new Error("sandbox runtime was not prepared");
    return { projectPath, sessionSandbox };
  }

  t.each([
    { launch: "fresh", resumeSessionId: undefined, before: "" },
    {
      launch: "resumed",
      resumeSessionId: "sess-claude",
      before: "sess-claude",
    },
  ])(
    "a $launch launch's Bash shells read the published session id",
    async ({ resumeSessionId, before }) => {
      const { projectPath, sessionSandbox } = await prepare();
      const seen: string[] = [];
      query.mockImplementation(({ options }) =>
        (async function* () {
          // The provider process runs a Bash tool shell, as Claude Code does.
          const toolShell = () =>
            collectStdout(
              options.spawnClaudeCodeProcess({
                command: "/bin/sh",
                args: [
                  "-c",
                  `bash -c 'printf "%s" "\${AGENTCTL_SESSION_ID-}"'`,
                ],
                cwd: options.cwd,
                env: options.env,
                signal: new AbortController().signal,
              }),
            );
          seen.push(await toolShell());
          yield {
            type: "system",
            subtype: "init",
            session_id: "sess-claude",
            model: "claude-test",
          };
          seen.push(await toolShell());
          yield {
            type: "result",
            session_id: "sess-claude",
            subtype: "success",
          };
        })(),
      );

      const session = await new ClaudeProvider().startSession({
        cwd: projectPath,
        resumeSessionId,
        sessionSandbox,
      });
      try {
        for await (const message of session.iterator) {
          if (message.type === "system" && message.subtype === "init") {
            await session.publishAgentctlSessionId?.("sess-claude");
          }
        }
      } finally {
        await session.abort();
      }
      expect(seen).toEqual([before, "sess-claude"]);
      expect(query).toHaveBeenLastCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            strictMcpConfig: true,
            mcpServers: {},
            settings: expect.objectContaining({
              disableClaudeAiConnectors: true,
            }),
            disallowedTools: expect.arrayContaining(["mcp__*"]),
          }),
        }),
      );
    },
  );

  async function launchSystemPrompt(
    options: Pick<
      Parameters<ClaudeProvider["startSession"]>[0],
      "cwd" | "globalInstructions" | "sessionSandbox"
    >,
  ): Promise<unknown> {
    let systemPrompt: unknown;
    query.mockImplementation(({ options: queryOptions }) =>
      (async function* () {
        systemPrompt = queryOptions.systemPrompt;
        yield { type: "result", session_id: "sess-claude", subtype: "success" };
      })(),
    );
    const session = await new ClaudeProvider().startSession(options);
    try {
      for await (const _message of session.iterator) {
        // drain the single result
      }
    } finally {
      await session.abort();
    }
    return systemPrompt;
  }

  t("appends the sandbox boundary to a sandboxed launch", async () => {
    const { projectPath, sessionSandbox } = await prepare();
    const systemPrompt = await launchSystemPrompt({
      cwd: projectPath,
      globalInstructions: "Be terse.",
      sessionSandbox,
    });
    expect(systemPrompt).toMatchObject({
      type: "preset",
      preset: "claude_code",
      append: expect.stringMatching(
        /^Be terse\.\n\n\[Session sandbox\]\n.*dangerouslyDisableSandbox/s,
      ),
    });
  });

  it("adds no sandbox boundary to an unsandboxed launch", async () => {
    vi.stubEnv("BASH_ENV", undefined);
    const systemPrompt = await launchSystemPrompt({
      cwd: scratch,
      globalInstructions: "Be terse.",
    });
    expect(systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Be terse.",
    });
    expect(query.mock.lastCall?.[0].options.strictMcpConfig).toBeUndefined();
    expect(
      query.mock.lastCall?.[0].options.settings?.disableClaudeAiConnectors,
    ).toBeUndefined();
  });

  t.each([true, false])(
    "applies limited-user instructions with startFromDefault=%s",
    async (startFromDefault) => {
      const { projectPath, sessionSandbox } = await prepare({
        startFromDefault,
        text: "Shared instruction.\n\nUser instruction.",
      });
      const systemPrompt = await launchSystemPrompt({
        cwd: projectPath,
        globalInstructions: "Owner defaults.",
        sessionSandbox,
      });
      expect(systemPrompt).toMatchObject(
        startFromDefault
          ? {
              type: "preset",
              snapshot: false,
              append: expect.stringMatching(
                /^Owner defaults\.\n\nShared instruction\.\n\nUser instruction\./,
              ),
            }
          : {
              type: "custom",
              snapshot: false,
              prompt: expect.stringMatching(
                /^Shared instruction\.\n\nUser instruction\./,
              ),
            },
      );
      expect(JSON.stringify(systemPrompt)).toContain("Session sandbox");
      if (!startFromDefault)
        expect(JSON.stringify(systemPrompt)).not.toContain("Owner defaults");
    },
  );
});
