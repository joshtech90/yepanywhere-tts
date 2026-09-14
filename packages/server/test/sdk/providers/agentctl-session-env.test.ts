import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyAgentctlBashEnvInto,
  createAgentctlSessionEnvBridge,
  pickStaticAgentEnvironment,
} from "../../../src/sdk/providers/agentctl-session-env.js";

function runBash(env: NodeJS.ProcessEnv): string {
  return execFileSync(
    "bash",
    [
      "-c",
      `printf "original=%s agentctl=%s wake_url=%s wake_token=%s debug_url=%s debug_token=%s" "\${YA_ORIGINAL_BASH_ENV_MARKER-}" "\${AGENTCTL_SESSION_ID-}" "\${YEP_SESSION_WAKE_URL-}" "\${YEP_SESSION_WAKE_TOKEN-}" "\${YEP_BROWSER_DEBUG_AGENT_URL-}" "\${YEP_BROWSER_DEBUG_CALLER_TOKEN-}"`,
    ],
    {
      encoding: "utf-8",
      env,
      // Vitest's worker stdin is socket-backed, which can make Bash select its
      // remote-shell startup path and skip BASH_ENV. Model an ordinary
      // non-interactive provider tool shell explicitly.
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function isBashAvailable(): boolean {
  try {
    execFileSync("bash", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function bridgeTestEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...overrides };
  delete env.AGENTCTL_SESSION_ID;
  delete env.YA_ORIGINAL_BASH_ENV_MARKER;
  delete env.YEP_ORIGINAL_BASH_ENV;
  delete env.YEP_SESSION_WAKE_TOKEN;
  delete env.YEP_SESSION_WAKE_URL;
  // Scrub any inherited BASH_ENV so these tests stay hermetic when run from a
  // shell that already has the agentctl session-env bridge installed (e.g.
  // dogfooding YA). Callers that need an "original" BASH_ENV pass it via
  // overrides.
  delete env.BASH_ENV;
  return env;
}

const bashIt = process.platform !== "win32" && isBashAvailable() ? it : it.skip;

describe("agentctl session env bridge", () => {
  bashIt("publishes the supervising server URL to tool subprocesses", () => {
    const bridge = createAgentctlSessionEnvBridge();
    try {
      const env = bridge.extendEnv({
        ...bridgeTestEnv(),
        AGENT_SERVER_URL: "http://stale.invalid/",
      });
      expect(env.AGENT_SERVER_URL).toBeUndefined();
      bridge.publishSessionId("session", {
        AGENT_SERVER_URL: "http://localhost:4010/",
      });
      expect(
        execFileSync("bash", ["-c", 'printf "%s" "$AGENT_SERVER_URL"'], {
          encoding: "utf8",
          env,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ).toBe("http://localhost:4010/");
    } finally {
      bridge.cleanup();
    }
  });
  bashIt(
    "does not restore an outer self grant through a chained startup file",
    () => {
      const outer = createAgentctlSessionEnvBridge();
      const outerEnv = outer.extendEnv({
        ...bridgeTestEnv(),
        AGENT_YA_API_URL: "http://127.0.0.1:1234",
        AGENT_YA_API_TOKEN: "outer-grant",
      });
      const inner = createAgentctlSessionEnvBridge();
      try {
        const launch = { ...outerEnv };
        delete launch.AGENT_YA_API_URL;
        delete launch.AGENT_YA_API_TOKEN;
        // A nested provider chains the outer BASH_ENV but must not regain its
        // grant, including the interval before its own canonical id is known.
        delete launch.YEP_ORIGINAL_BASH_ENV;
        const env = inner.extendEnv(launch);
        const read = () =>
          execFileSync(
            "bash",
            [
              "-c",
              `printf "%s|%s" "\${AGENT_YA_API_URL-}" "\${AGENT_YA_API_TOKEN-}"`,
            ],
            { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        expect(read()).toBe("|");
        inner.publishSessionId("inner-session");
        expect(read()).toBe("|");
      } finally {
        inner.cleanup();
        outer.cleanup();
      }
    },
  );
  bashIt("publishes AGENTCTL_SESSION_ID to later Bash shells", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ya-agentctl-env-test-"));
    const originalBashEnvPath = join(tempDir, "original-bash-env.sh");
    writeFileSync(
      originalBashEnvPath,
      "export YA_ORIGINAL_BASH_ENV_MARKER=kept\n",
      "utf-8",
    );
    const bridge = createAgentctlSessionEnvBridge();

    try {
      const sourceEnv = bridgeTestEnv();
      sourceEnv.YEP_SESSION_WAKE_URL = "http://stale.invalid/";
      sourceEnv.YEP_SESSION_WAKE_TOKEN = "stale-token";
      sourceEnv.YEP_BROWSER_DEBUG_AGENT_URL = "http://stale.invalid/debug";
      sourceEnv.YEP_BROWSER_DEBUG_CALLER_TOKEN = "stale-debug-token";
      const env = bridge.extendEnv({
        ...sourceEnv,
        BASH_ENV: originalBashEnvPath,
      });

      expect(runBash(env)).toBe(
        "original=kept agentctl= wake_url= wake_token= debug_url= debug_token=",
      );
      expect(env.YEP_BROWSER_DEBUG_AGENT_URL).toBeUndefined();
      expect(env.YEP_BROWSER_DEBUG_CALLER_TOKEN).toBeUndefined();

      bridge.publishSessionId("sess-'quoted");

      expect(runBash(env)).toBe(
        "original=kept agentctl=sess-'quoted wake_url= wake_token= debug_url= debug_token=",
      );
    } finally {
      bridge.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  bashIt("seeds a known resume session id before provider startup", () => {
    const bridge = createAgentctlSessionEnvBridge(
      "sess-resume",
      (sessionId) => ({
        YEP_SESSION_WAKE_URL: `http://127.0.0.1/session-wake/${sessionId}`,
        YEP_SESSION_WAKE_TOKEN: "wake-'token",
      }),
    );

    try {
      expect(runBash(bridge.extendEnv(bridgeTestEnv()))).toBe(
        "original= agentctl=sess-resume wake_url=http://127.0.0.1/session-wake/sess-resume wake_token=wake-'token debug_url= debug_token=",
      );
    } finally {
      bridge.cleanup();
    }
  });

  bashIt("refreshes browser debugging credentials for later shells", () => {
    const bridge = createAgentctlSessionEnvBridge("sess-retained", () => ({
      YEP_SESSION_WAKE_URL: "http://127.0.0.1/session-wake/sess-retained",
      YEP_SESSION_WAKE_TOKEN: "wake-token",
      YEP_BROWSER_DEBUG_AGENT_URL: "http://127.0.0.1/old",
      YEP_BROWSER_DEBUG_CALLER_TOKEN: "old-token",
    }));

    try {
      const env = bridge.extendEnv(bridgeTestEnv());
      bridge.publishSessionId("sess-retained", {
        YEP_BROWSER_DEBUG_AGENT_URL: "http://127.0.0.1/new",
        YEP_BROWSER_DEBUG_CALLER_TOKEN: "new-token",
        UNRELATED_SECRET: "must-not-pass",
      });

      expect(runBash(env)).toBe(
        "original= agentctl=sess-retained wake_url=http://127.0.0.1/session-wake/sess-retained wake_token=wake-token debug_url=http://127.0.0.1/new debug_token=new-token",
      );
    } finally {
      bridge.cleanup();
    }
  });

  bashIt("copies the Bash bridge path without stripping the overlay", () => {
    const bridge = createAgentctlSessionEnvBridge();
    try {
      const target: Record<string, string> = {
        KEEP_ME: "yes",
        AGENT_SERVER_URL: "http://child.invalid/",
      };
      copyAgentctlBashEnvInto(target, bridge, {
        sessionId: "sess-copy",
        baseEnv: bridgeTestEnv({ AGENT_SERVER_URL: "http://stale.invalid/" }),
      });
      expect(target.KEEP_ME).toBe("yes");
      expect(target.AGENT_SERVER_URL).toBe("http://child.invalid/");
      expect(target.BASH_ENV).toBeTruthy();
      expect(target.AGENTCTL_SESSION_ID).toBe("sess-copy");
      expect(
        execFileSync("bash", ["-c", 'printf "%s" "$AGENTCTL_SESSION_ID"'], {
          encoding: "utf8",
          env: { ...bridgeTestEnv(), ...target },
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ).toBe("sess-copy");
    } finally {
      bridge.cleanup();
    }
  });
  it("carries the artifact origin across the provider-host boundary", () => {
    // The host narrows the computed child environment to these names before
    // the worker sees it, and the worker has no other source for them. An
    // origin dropped here leaves the agent's capture tool with no interactive
    // delivery on a server that has one configured.
    expect(
      pickStaticAgentEnvironment({
        AGENT_SERVER_URL: "http://127.0.0.1:3400/",
        AGENT_ARTIFACT_VIEWER_ORIGIN: "http://artifacts.localhost:3400",
        YEP_SESSION_WAKE_URL: "http://127.0.0.1:3400/wake",
        YEP_SESSION_WAKE_TOKEN: "per-session-secret",
      }),
    ).toEqual({
      AGENT_SERVER_URL: "http://127.0.0.1:3400/",
      AGENT_ARTIFACT_VIEWER_ORIGIN: "http://artifacts.localhost:3400",
    });
  });
  bashIt("publishes the artifact origin to tool subprocesses", () => {
    const bridge = createAgentctlSessionEnvBridge();
    try {
      const env = bridge.extendEnv({
        ...bridgeTestEnv(),
        AGENT_ARTIFACT_VIEWER_ORIGIN: "http://stale.invalid",
      });
      expect(env.AGENT_ARTIFACT_VIEWER_ORIGIN).toBeUndefined();
      bridge.publishSessionId("session", {
        AGENT_ARTIFACT_VIEWER_ORIGIN: "http://artifacts.localhost:3400",
      });
      expect(
        execFileSync(
          "bash",
          ["-c", 'printf "%s" "$AGENT_ARTIFACT_VIEWER_ORIGIN"'],
          { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
        ),
      ).toBe("http://artifacts.localhost:3400");
    } finally {
      bridge.cleanup();
    }
  });
});
