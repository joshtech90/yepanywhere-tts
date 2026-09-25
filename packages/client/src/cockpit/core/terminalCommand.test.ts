import { describe, expect, it } from "vitest";
import {
  buildCockpitResumeCommand,
  cockpitProjectPathFromId,
} from "./terminalCommand";

function idFor(path: string): string {
  const bytes = new TextEncoder().encode(path);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("cockpit terminal command", () => {
  it("decodes project ids, including spaces and umlauts", () => {
    expect(
      cockpitProjectPathFromId(idFor("/home/lilith/Projects/AI Worker")),
    ).toBe("/home/lilith/Projects/AI Worker");
    expect(cockpitProjectPathFromId(idFor("/tmp/Bücher"))).toBe("/tmp/Bücher");
    expect(cockpitProjectPathFromId("%%%")).toBeNull();
  });

  it("builds quoted resume commands for Claude and Codex", () => {
    const projectId = idFor("/home/lilith/Joschas 'Ordner'");
    expect(
      buildCockpitResumeCommand({
        provider: "claude",
        projectId,
        sessionId: "24e22f93-9d63-44d6-b237-6d765a2b8346",
      }),
    ).toBe(
      "cd '/home/lilith/Joschas '\\''Ordner'\\''' && claude --resume 24e22f93-9d63-44d6-b237-6d765a2b8346",
    );
    expect(
      buildCockpitResumeCommand({
        provider: "codex",
        projectId,
        sessionId: "019a-thread",
      }),
    ).toContain("&& codex resume 019a-thread");
  });

  it("refuses unknown providers and ids with shell syntax", () => {
    const projectId = idFor("/tmp/x");
    expect(
      buildCockpitResumeCommand({
        provider: "gemini",
        projectId,
        sessionId: "a",
      }),
    ).toBeNull();
    expect(
      buildCockpitResumeCommand({
        provider: "claude",
        projectId,
        sessionId: "a; echo x",
      }),
    ).toBeNull();
  });
});
