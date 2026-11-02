import { spawn } from "node:child_process";
import { terminateChildProcess } from "../../client/e2e/support/process-lifecycle.js";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("starts speech backends when bound via CLI host override", async () => {
  const port = await new Promise<number>((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close((err) => (err ? rej(err) : res(p)));
    });
  });

  // Local reproduction: 2.20s fixed, 5.44s before the fix including the
  // negative readiness window. Keep startup bounded under parallel load.
  const tempDir = mkdtempSync(join(tmpdir(), "ya-speech-"));
  for (const d of ["data", "runtime", "claude", "codex", "gemini"]) {
    mkdirSync(join(tempDir, d), { recursive: true });
  }

  const serverRoot = fileURLToPath(new URL("..", import.meta.url));
  const child = spawn(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--import",
      new URL(
        "../../client/e2e/support/offline-update-check.mjs",
        import.meta.url,
      ).href,
      "--conditions",
      "source",
      "src/index.ts",
    ],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        HOST: "0.0.0.0",
        CLI_HOST_OVERRIDE: "true",
        PORT: String(port),
        MAINTENANCE_PORT: "0",
        AUTH_DISABLED: "true",
        TLS_CERT_PATH: "",
        TLS_KEY_PATH: "",
        YEP_PROVIDER_HOST_ENABLED: "false",
        YEP_STT_GROQ_API_KEY_FILES: "",
        YEP_STT_XAI_API_KEY: "",
        XAI_API_KEY: "",
        YEP_STT_DEEPGRAM_API_KEY: "",
        YEP_VOICE_BACKENDS: "",
        VOICE_INPUT: "true",
        HTTPS_SELF_SIGNED: "",
        SERVE_FRONTEND: "false",
        OPEN_BROWSER: "false",
        NODE_ENV: "production",
        NO_BACKEND_RELOAD: "true",
        NO_FRONTEND_RELOAD: "true",
        HOME: tempDir,
        USERPROFILE: tempDir,
        YEP_DATA_DIR: join(tempDir, "data"),
        YEP_PROVIDER_HOST_RUNTIME_DIR: join(tempDir, "runtime"),
        CLAUDE_SESSIONS_DIR: join(tempDir, "claude"),
        CODEX_SESSIONS_DIR: join(tempDir, "codex"),
        GEMINI_SESSIONS_DIR: join(tempDir, "gemini"),
        YEP_STT_GROQ_API_KEY: "fake",
      },
      stdio: "ignore",
      detached: process.platform !== "win32",
    },
  );

  try {
    const base = `http://127.0.0.1:${port}`;
    const healthDeadline = Date.now() + 8_000;
    let healthy = false;
    while (Date.now() < healthDeadline) {
      try {
        const res = await fetch(`${base}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(healthy).toBe(true);

    let voiceBackends: string[] = [];
    const voiceDeadline = Date.now() + 3_000;
    while (Date.now() < voiceDeadline) {
      try {
        const res = await fetch(`${base}/api/version`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          const data = (await res.json()) as { voiceBackends?: string[] };
          voiceBackends = data.voiceBackends ?? [];
          if (voiceBackends.includes("ya-groq")) break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(voiceBackends).toContain("ya-groq");
  } finally {
    await terminateChildProcess(child, "CLI-host speech startup");
    rmSync(tempDir, { recursive: true, force: true });
  }
}, 15_000);
