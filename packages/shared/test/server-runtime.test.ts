import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getServerRuntime,
  isSupportedServerRuntime,
  SERVER_NODE_RANGE,
} from "../src/server-runtime.js";

describe("server runtime contract", () => {
  it.each([
    "22.16.0",
    "22.99.9",
    "23.11.0",
    "23.11.1",
    "24.10.0",
    "24.20.0",
    "25.0.0",
    "26.0.0",
    "22.16.0+build.1",
  ])("accepts Node %s", (version) => {
    expect(isSupportedServerRuntime({ kind: "node", version })).toBe(true);
  });
  it.each([
    "20.20.0",
    "21.7.3",
    "22.0.0",
    "22.15.9",
    "23.0.0",
    "23.10.9",
    "24.0.0",
    "24.9.9",
    "22.16.0-rc.1",
    "26.0.0-nightly",
    "22.16",
    "022.16.0",
    "garbage",
    "22.16.0+",
  ])("rejects Node %s", (version) => {
    expect(isSupportedServerRuntime({ kind: "node", version })).toBe(false);
  });
  it.each(["1.3.14", "1.3.15", "1.4.0", "2.0.0"])(
    "accepts Bun %s independently of its Node compatibility version",
    (bun) => {
      const runtime = getServerRuntime({ bun, node: "24.0.0" });
      expect(runtime).toEqual({ kind: "bun", version: bun });
      expect(isSupportedServerRuntime(runtime)).toBe(true);
    },
  );
  it.each(["1.3.13", "1.2.99", "0.9.0", "1.3.14-canary", ""])(
    "rejects obsolete or invalid Bun %s even with a supported Node compatibility version",
    (bun) => {
      expect(
        isSupportedServerRuntime(getServerRuntime({ bun, node: "24.20.0" })),
      ).toBe(false);
    },
  );
  it("keeps unavailable identity unknown", () => {
    expect(getServerRuntime({})).toEqual({ kind: "unknown", version: null });
    expect(
      isSupportedServerRuntime({ kind: "unknown", version: "24.20.0" }),
    ).toBe(false);
  });
  it("keeps published/development engines aligned with the preflight", () => {
    for (const path of ["../../../package.json", "../../server/package.json"]) {
      const pkg = JSON.parse(
        readFileSync(new URL(path, import.meta.url), "utf8"),
      );
      expect(pkg.engines.node).toBe(SERVER_NODE_RANGE);
    }
  });
});
