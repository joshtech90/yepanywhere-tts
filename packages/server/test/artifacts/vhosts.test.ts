import { describe, expect, it } from "vitest";
import {
  matchVhost,
  parseVhostPublicRoot,
  parseVhosts,
  vhostHostnames,
  vhostSessionEnvironment,
} from "../../src/artifacts/vhosts.js";
import { validateArtifactConfig } from "../../src/artifacts/config.js";
import { artifactViewerAgentEnvironment } from "../../src/artifacts/agentEnvironment.js";

describe("artifact vhosts", () => {
  it("parses names, ports, optional env, and a public root", () => {
    const vhosts = parseVhosts([
      { name: "Plan", port: 19432, env: "PLANNOTATOR_PORT" },
      { name: "review", port: 19433 },
    ]);
    expect(vhosts).toEqual([
      { name: "plan", port: 19432, env: "PLANNOTATOR_PORT" },
      { name: "review", port: 19433 },
    ]);
    expect(parseVhostPublicRoot("GRaehl.org.")).toBe("graehl.org");
    expect(parseVhostPublicRoot("")).toBeUndefined();
    expect(parseVhostPublicRoot(undefined, "graehl.org")).toBe("graehl.org");
  });

  it("matches name.localhost always and name.publicRoot when set", () => {
    const vhosts = parseVhosts([{ name: "plan", port: 19432 }]);
    expect(matchVhost("plan.localhost:3400", vhosts)?.port).toBe(19432);
    expect(matchVhost("plan.graehl.org", vhosts, "graehl.org")?.port).toBe(
      19432,
    );
    expect(matchVhost("plan.graehl.org", vhosts)).toBeUndefined();
    expect(matchVhost("artifacts.localhost:3400", vhosts)).toBeUndefined();
    expect(vhostHostnames(vhosts, "graehl.org")).toEqual([
      "plan.localhost",
      "plan.graehl.org",
    ]);
  });

  it("rejects reserved names, YEP env, and the artifact listener port", () => {
    expect(() => parseVhosts([{ name: "artifacts", port: 19432 }])).toThrow(
      /Invalid vhost name/,
    );
    expect(() =>
      parseVhosts([{ name: "plan", port: 19432, env: "YEP_SECRET" }]),
    ).toThrow(/Invalid vhost env/);
    expect(() =>
      validateArtifactConfig({
        port: 4402,
        vhosts: [{ name: "plan", port: 4402 }],
      }),
    ).toThrow(/artifact listener port/);
  });

  it("keeps prior vhosts when a PUT omits the field", () => {
    const previous = parseVhosts([{ name: "plan", port: 19432 }]);
    expect(
      validateArtifactConfig({ port: 4402 }, 7, { vhosts: previous }),
    ).toMatchObject({ vhosts: previous });
    expect(
      validateArtifactConfig({ port: 4402, vhosts: [] }, 7, {
        vhosts: previous,
      }).vhosts,
    ).toEqual([]);
  });

  it("exports env names as the mapped port to local host sessions", () => {
    const server = {
      available: true,
      config: {
        localOrigin: "http://artifacts.localhost:3400",
        vhosts: [{ name: "plan", port: 19432, env: "PLANNOTATOR_PORT" }],
      },
    };
    expect(
      artifactViewerAgentEnvironment(server, "http://127.0.0.1:3400/"),
    ).toEqual({
      AGENT_ARTIFACT_VIEWER_ORIGIN: "http://artifacts.localhost:3400",
      PLANNOTATOR_PORT: "19432",
      AGENT_VHOST_ENV_NAMES: '["PLANNOTATOR_PORT"]',
    });
    expect(
      artifactViewerAgentEnvironment(server, "https://ya.example.org", "ssh"),
    ).toEqual({});
    expect(vhostSessionEnvironment(server.config.vhosts)).toEqual({
      PLANNOTATOR_PORT: "19432",
      AGENT_VHOST_ENV_NAMES: '["PLANNOTATOR_PORT"]',
    });
  });
});
