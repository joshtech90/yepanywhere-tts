import { describe, expect, it } from "vitest";
import { artifactViewerAgentEnvironment } from "../../src/artifacts/agentEnvironment.js";

const listening = {
  available: true,
  config: {
    localOrigin: "http://artifacts.localhost:3400",
    publicOrigin: "https://artifacts.example.org",
  },
};

describe("artifactViewerAgentEnvironment", () => {
  it("announces the local origin to a session that reaches YA over loopback", () => {
    expect(
      artifactViewerAgentEnvironment(listening, "http://127.0.0.1:3400/"),
    ).toEqual({
      AGENT_ARTIFACT_VIEWER_ORIGIN: "http://artifacts.localhost:3400",
    });
  });

  it("stays silent for a remote session, which cannot reach that origin", () => {
    expect(
      artifactViewerAgentEnvironment(listening, "https://ya.example.org"),
    ).toEqual({});
  });

  it("stays silent when the session has no YA base at all", () => {
    expect(artifactViewerAgentEnvironment(listening, undefined)).toEqual({});
  });

  it("stays silent when interactive delivery is unavailable or unconfigured", () => {
    expect(
      artifactViewerAgentEnvironment(
        { ...listening, available: false },
        "http://127.0.0.1:3400/",
      ),
    ).toEqual({});
    expect(
      artifactViewerAgentEnvironment(
        { available: true, config: {} },
        "http://127.0.0.1:3400/",
      ),
    ).toEqual({});
  });

  it("stays silent rather than guessing from an unparseable YA base", () => {
    expect(artifactViewerAgentEnvironment(listening, "not a url")).toEqual({});
  });
});
