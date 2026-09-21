import { describe, expect, it } from "vitest";
import { whichCommand } from "../../src/sdk/which-command.js";

describe("whichCommand", () => {
  it("asks Windows for every PATH match with where", () => {
    expect(whichCommand("claude", "win32")).toBe("where claude");
  });

  it("uses which elsewhere", () => {
    expect(whichCommand("claude", "linux")).toBe("which claude");
    expect(whichCommand("codex", "darwin")).toBe("which codex");
  });

  it("defaults to the running platform", () => {
    expect(whichCommand("claude")).toBe(
      whichCommand("claude", process.platform),
    );
  });
});
