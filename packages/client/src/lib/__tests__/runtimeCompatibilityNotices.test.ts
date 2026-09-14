import { describe, expect, it } from "vitest";
import type { ServerRuntimeInfo } from "@yep-anywhere/shared/server-runtime";
import type { TranslationFn } from "../../i18n";
import messages from "../../i18n/en.json";
import { getRemoteCompatibilityNotices } from "../remoteCompatibilityNotices";

const t: TranslationFn = (key, vars) =>
  Object.entries(vars ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    messages[key],
  );
function notices(runtime?: ServerRuntimeInfo, sourceKey = "direct:one") {
  return getRemoteCompatibilityNotices({
    currentVersion: "0.8.1",
    latestVersion: null,
    updateAvailable: false,
    runtimeNotice: { runtime, sourceKey, t },
  });
}
describe("advisory runtime notices", () => {
  it("warns honestly for absent metadata even when update checking is offline", () => {
    const notice = notices()[0];
    expect(notice?.title).toBe("Check the runtime before updating YA");
    expect(notice?.body).toContain("You can keep using this server");
    expect(notice?.severity).toBe("recommended");
    expect(notice?.action?.command).toBeUndefined();
  });
  it.each(["22.16.0", "23.11.0", "24.10.0", "26.0.0"])(
    "does not warn supported Node %s",
    (version) => {
      expect(notices({ kind: "node", version })).toEqual([]);
    },
  );
  it("warns obsolete Node with the observed version", () => {
    const notice = notices({ kind: "node", version: "20.20.0" })[0];
    expect(notice?.title).toBe("Upgrade Node.js before updating YA");
    expect(notice?.versionSummary).toBe("Server runtime: Node.js 20.20.0");
  });
  it("uses Bun guidance without suggesting Node for an obsolete Bun", () => {
    expect(notices({ kind: "bun", version: "1.3.13" })[0]?.body).not.toContain(
      "Node",
    );
    expect(notices({ kind: "bun", version: "1.3.14" })).toEqual([]);
  });
  it("keeps unknown identity distinct from obsolete Node", () => {
    expect(notices({ kind: "unknown", version: null })[0]?.title).toContain(
      "Check",
    );
    expect(notices({ kind: "node", version: null })[0]?.title).toContain(
      "Check",
    );
  });
  it("scopes snoozes to source and observed runtime", () => {
    expect(notices(undefined, "one")[0]?.dismissKey).not.toBe(
      notices(undefined, "two")[0]?.dismissKey,
    );
    expect(notices()[0]?.dismissKey).not.toBe(
      notices({ kind: "node", version: "20.12.2" })[0]?.dismissKey,
    );
  });
  it("preserves security priority and existing update commands", () => {
    const result = getRemoteCompatibilityNotices({
      currentVersion: "0.5.0",
      latestVersion: "0.8.2",
      updateAvailable: true,
      relayUsername: "host",
      resumeProtocolVersion: 2,
      remoteCompatibilityLevel: 10,
      runtimeNotice: { sourceKey: "relay:host", t },
    });
    expect(result[0]?.severity).toBe("security");
    expect(result[0]?.action?.command).toBe("npm update -g yepanywhere");
    expect(result.some((notice) => notice.id === "server-runtime-node22")).toBe(
      true,
    );
  });
});
