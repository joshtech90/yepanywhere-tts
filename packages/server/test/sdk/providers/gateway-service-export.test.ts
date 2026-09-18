import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GatewayService } from "@yep-anywhere/shared";
import { gatewayServiceCliInvocations } from "@yep-anywhere/shared";
import { syncGatewayServiceExports } from "../../../src/sdk/providers/gatewayServiceExport.js";

function service(overrides: Partial<GatewayService> = {}): GatewayService {
  return {
    id: "vllm",
    label: "DeepSeek V4 Flash",
    shortName: "vllm",
    url: "http://127.0.0.1:8001",
    enabled: true,
    autoStop: false,
    autoStopAfterSeconds: 0,
    codexEnabled: true,
    codexWireApi: "chat",
    ...overrides,
  };
}

describe("gateway service export", () => {
  let paths: { codexHome: string; claudeHome: string };

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "ya-gateway-export-"));
    paths = {
      codexHome: join(root, "codex"),
      claudeHome: join(root, "claude"),
    };
  });

  afterEach(() => {
    paths = { codexHome: "", claudeHome: "" };
  });

  it("writes a Codex profile and a Claude settings file per service", async () => {
    const result = await syncGatewayServiceExports({
      services: [service({ codexWireApi: "responses" })],
      enabled: true,
      paths,
    });

    expect(result.written).toHaveLength(2);
    const codex = await readFile(
      join(paths.codexHome, "ya-vllm.config.toml"),
      "utf8",
    );
    expect(codex).toContain('model_provider = "ya_vllm"');
    expect(codex).toContain("[model_providers.ya_vllm]");
    expect(codex).toContain('base_url = "http://127.0.0.1:8001/v1"');
    expect(codex).toContain('wire_api = "responses"');
    expect(codex).toContain('name = "DeepSeek V4 Flash"');

    const claude = JSON.parse(
      await readFile(join(paths.claudeHome, "ya-vllm.settings.json"), "utf8"),
    );
    expect(claude.env).toEqual({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8001",
      ANTHROPIC_AUTH_TOKEN: "dummy",
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
      // Nothing declared, so the CLI is told not to assume a window rather
      // than to assume its 200K default for an unknown model.
      CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1",
    });
  });

  it("states the declared window so a terminal session is not truncated", async () => {
    await syncGatewayServiceExports({
      services: [
        service({ contextWindowTokens: 252_000, maxOutputTokens: 32_000 }),
      ],
      enabled: true,
      paths,
    });

    const claude = JSON.parse(
      await readFile(join(paths.claudeHome, "ya-vllm.settings.json"), "utf8"),
    );
    expect(claude.env).toMatchObject({
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "252000",
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "220000",
    });
    expect(claude.env).not.toHaveProperty(
      "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT",
    );
  });

  it("states the exact commands that reach a service", () => {
    expect(gatewayServiceCliInvocations(service(), paths)).toEqual({
      claude: `claude --settings ${join(paths.claudeHome, "ya-vllm.settings.json")}`,
      codex: "codex -p ya-vllm",
    });
  });

  it("omits the Codex command for a service Codex may not use", () => {
    expect(
      gatewayServiceCliInvocations(service({ codexEnabled: false }), paths),
    ).not.toHaveProperty("codex");
  });

  it("writes no Codex profile for a service Codex may not use", async () => {
    await syncGatewayServiceExports({
      services: [service({ codexEnabled: false })],
      enabled: true,
      paths,
    });

    await expect(readdir(paths.codexHome)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readdir(paths.claudeHome)).resolves.toEqual([
      "ya-vllm.settings.json",
    ]);
  });

  it("removes what it wrote for a service that is gone", async () => {
    await syncGatewayServiceExports({
      services: [service(), service({ id: "copilot", codexEnabled: true })],
      enabled: true,
      paths,
    });
    const result = await syncGatewayServiceExports({
      services: [service()],
      enabled: true,
      paths,
    });

    expect(result.removed.map((path) => path.split("/").pop())).toEqual(
      expect.arrayContaining([
        "ya-copilot.settings.json",
        "ya-copilot.config.toml",
      ]),
    );
    await expect(readdir(paths.codexHome)).resolves.toEqual([
      "ya-vllm.config.toml",
    ]);
  });

  it("undoes the whole export when the setting is turned off", async () => {
    await syncGatewayServiceExports({
      services: [service()],
      enabled: true,
      paths,
    });
    await syncGatewayServiceExports({
      services: [service()],
      enabled: false,
      paths,
    });

    await expect(readdir(paths.codexHome)).resolves.toEqual([]);
    await expect(readdir(paths.claudeHome)).resolves.toEqual([]);
  });

  it("leaves a same-named file YA did not write alone", async () => {
    await mkdir(paths.codexHome, { recursive: true });
    const handWritten = join(paths.codexHome, "ya-mine.config.toml");
    await writeFile(handWritten, 'model_provider = "mine"\n');

    const result = await syncGatewayServiceExports({
      services: [],
      enabled: false,
      paths,
    });

    expect(result.removed).toEqual([]);
    await expect(readFile(handWritten, "utf8")).resolves.toContain("mine");
  });

  it("exports nothing for a disabled service", async () => {
    const result = await syncGatewayServiceExports({
      services: [service({ enabled: false })],
      enabled: true,
      paths,
    });

    expect(result.written).toEqual([]);
  });
});
