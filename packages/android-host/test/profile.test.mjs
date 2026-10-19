import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hostProfile, initializeProfile } from "../runtime/profile.mjs";

test("direct and AAR use separate private homes with external observation disabled", () => {
  const direct = hostProfile("/home/user");
  const aar = hostProfile("/home/user", {
    providerMode: "aar",
    aarToken: `aar_${"a".repeat(43)}`,
  });
  assert.equal(direct.env.PORT, "13400");
  assert.equal(hostProfile("/home/user", {}, 13420).env.PORT, "13420");
  assert.throws(() => hostProfile("/home/user", {}, 0), /Host port/);
  assert.notEqual(direct.env.CODEX_HOME, aar.env.CODEX_HOME);
  assert.equal(direct.env.YEP_EXTERNAL_SESSIONS, "false");
  assert.equal(direct.env.YEP_RELAY_KEEPALIVE_PROFILE, "battery");
  assert.equal(
    hostProfile("/home/user", { relayKeepaliveProfile: "default" }).env
      .YEP_RELAY_KEEPALIVE_PROFILE,
    "default",
  );
  assert.throws(
    () => hostProfile("/home/user", { relayKeepaliveProfile: "invalid" }),
    /relayKeepaliveProfile/,
  );
  assert.equal(direct.env.AUTH_DISABLED, "false");
  assert.equal(direct.env.AAR_TOKEN, undefined);
  assert.equal(aar.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:18417/claude");
  assert(!aar.codexConfig.includes(aar.env.AAR_TOKEN));
  assert.throws(() =>
    hostProfile("/home/user", {
      providerMode: "aar",
      aarToken: aar.env.AAR_TOKEN,
      aarEndpoint: "http://example.com",
    }),
  );
});

test("initialization preserves existing provider configuration and refuses AAR substitution", () => {
  const home = mkdtempSync(join(tmpdir(), "ya-host-profile-"));
  try {
    const profile = hostProfile(home);
    initializeProfile(profile);
    const file = join(profile.env.CODEX_HOME, "config.toml");
    writeFileSync(file, "# user configuration\n");
    initializeProfile(profile);
    assert.equal(readFileSync(file, "utf8"), "# user configuration\n");
    const aar = hostProfile(home, {
      providerMode: "aar",
      aarToken: `aar_${"a".repeat(43)}`,
    });
    initializeProfile(aar);
    const changed = hostProfile(home, {
      providerMode: "aar",
      aarToken: `aar_${"b".repeat(43)}`,
      aarEndpoint: "https://router.example",
    });
    assert.throws(() => initializeProfile(changed), /differs/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
