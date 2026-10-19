import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One profile contract for Android and Linux. No workstation stores are used. */
export function hostProfile(home, development = {}, port = 13400) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Host port must be an integer from 1024 to 65535");
  const mode = development.providerMode ?? "direct";
  if (!["direct", "aar", "mock"].includes(mode)) {
    throw new Error("providerMode must be direct, aar, or mock");
  }
  const relayKeepaliveProfile = development.relayKeepaliveProfile ?? "battery";
  if (!["default", "battery"].includes(relayKeepaliveProfile))
    throw new Error("relayKeepaliveProfile must be default or battery");
  const env = {
    HOME: home,
    USER: "user",
    LOGNAME: "user",
    HOSTNAME: "ya-phone",
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    YEP_DATA_DIR: join(home, "data"),
    CLAUDE_CONFIG_DIR: join(home, "profiles", mode, "claude"),
    CODEX_HOME: join(home, "profiles", mode, "codex"),
    CLAUDE_CODE_EXECUTABLE: "/opt/claude/claude",
    ENABLED_PROVIDERS: "claude,codex",
    YEP_EXTERNAL_SESSIONS: "false",
    CODEX_WATCH_PERIODIC_RESCAN_MS: "0",
    // Continuous 10 ms diagnostics keep PRoot busy even when the host is idle.
    YEP_RESOURCE_SAMPLE_SECONDS: "0",
    YEP_RELAY_KEEPALIVE_PROFILE: relayKeepaliveProfile,
    YEP_PROVIDER_HOST_ENABLED: "false",
    VOICE_INPUT: "false",
    AUTH_DISABLED: "false",
    SERVE_FRONTEND: "true",
    CLIENT_DIST_PATH: "/opt/yep/client-dist",
    SHELL: "/bin/bash",
    TMPDIR: "/tmp",
    PATH: "/opt/codex/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    USE_BUILTIN_RIPGREP: "0",
    ADB_LIBUSB: "0",
    ADB_MDNS_AUTO_CONNECT: "",
    ADB_LOCAL_TRANSPORT_MAX_PORT: "5553",
  };
  if (mode === "mock") env.USE_MOCK_SDK = "true";
  let codexConfig =
    '# YA Host: Android app confinement remains; PRoot is not a sandbox.\nsandbox_mode = "danger-full-access"\n';
  if (mode === "aar") {
    const endpoint = new URL(
      development.aarEndpoint ?? "http://127.0.0.1:18417",
    );
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol === "http:" &&
        !["127.0.0.1", "localhost", "host.docker.internal"].includes(
          endpoint.hostname,
        ))
    )
      throw new Error(
        "AAR needs HTTPS or an explicit development loopback endpoint",
      );
    if (!/^aar_[A-Za-z0-9_-]{43}$/.test(development.aarToken ?? "")) {
      throw new Error("AAR mode requires a revocable gateway grant");
    }
    const base = endpoint.href.replace(/\/$/, "");
    env.AAR_TOKEN = development.aarToken;
    // Derived gateway header only, not an upstream paid API credential.
    env.OPENAI_API_KEY = development.aarToken;
    env.ANTHROPIC_API_KEY = development.aarToken;
    env.ANTHROPIC_BASE_URL = `${base}/claude`;
    codexConfig += `model_provider = "aar"\n[model_providers.aar]\nname = "Development AAR"\nbase_url = ${JSON.stringify(`${base}/codex`)}\nwire_api = "responses"\nenv_key = "AAR_TOKEN"\n`;
  }
  return { mode, env, codexConfig };
}

export function initializeProfile(profile) {
  for (const directory of [
    profile.env.YEP_DATA_DIR,
    profile.env.CLAUDE_CONFIG_DIR,
    profile.env.CODEX_HOME,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const config = join(profile.env.CODEX_HOME, "config.toml");
  try {
    writeFileSync(config, profile.codexConfig, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Existing user edits win. Never silently repoint a stored provider.
    if (
      profile.mode === "aar" &&
      readFileSync(config, "utf8") !== profile.codexConfig
    ) {
      throw new Error(
        "Existing AAR profile differs; review its configuration before switching endpoints",
      );
    }
  }
}
