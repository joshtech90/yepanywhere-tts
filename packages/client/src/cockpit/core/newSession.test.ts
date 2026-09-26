import type { ProviderInfo } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  initialLaunchSelection,
  launchChoices,
  launchOptions,
  normalizeProjectPath,
  rememberLaunch,
  selectionForProvider,
} from "./newSession";

const legacy = { thinkingMode: "auto" as const, effortLevel: "high" as const };

function provider(overrides: Partial<ProviderInfo>): ProviderInfo {
  return {
    name: "claude",
    displayName: "Claude",
    installed: true,
    authenticated: true,
    enabled: true,
    models: [
      { id: "sonnet", name: "Sonnet", supportedEffortLevels: ["low", "high"] },
      { id: "haiku", name: "Haiku", supportedEffortLevels: ["low", "high"] },
    ],
    ...overrides,
  };
}

const claude = provider({});
const codex = provider({
  name: "codex",
  displayName: "Codex",
  models: [
    { id: "gpt-a", name: "GPT A" },
    { id: "gpt-b", name: "GPT B", isDefault: true },
  ],
});

describe("Cockpit new-session selection", () => {
  it("starts from the saved provider, model and permission mode", () => {
    const selection = initialLaunchSelection(
      {
        provider: "codex",
        permissionMode: "acceptEdits",
        providers: { codex: { model: "gpt-a", effortLevel: "low" } },
      },
      [claude, codex],
      legacy,
    );
    expect(selection).toEqual({
      provider: "codex",
      model: "gpt-a",
      thinkingMode: "auto",
      effortLevel: "low",
      permissionMode: "acceptEdits",
    });
  });

  it("prefers Claude and the provider default model without saved defaults", () => {
    expect(initialLaunchSelection(undefined, [codex, claude], legacy)).toMatchObject({
      provider: "claude",
      model: "sonnet",
      permissionMode: "default",
    });
    expect(
      selectionForProvider(undefined, codex, legacy, "plan"),
    ).toMatchObject({ provider: "codex", model: "gpt-b", permissionMode: "plan" });
  });

  it("ignores providers that are not installed", () => {
    expect(
      initialLaunchSelection(undefined, [provider({ installed: false })], legacy),
    ).toBeNull();
  });

  it("snaps an unoffered effort down and sends thinking as one option", () => {
    const choices = launchChoices(
      {
        provider: "claude",
        model: "haiku",
        thinkingMode: "on",
        effortLevel: "max",
        permissionMode: "auto",
      },
      claude,
    );
    expect(choices.effective.effortLevel).toBe("high");
    // Auto approval needs a model that advertises it.
    expect(choices.effective.permissionMode).toBe("default");
    expect(launchOptions(choices)).toEqual({
      provider: "claude",
      model: "haiku",
      thinking: "on:high",
      mode: "default",
    });
  });

  it("remembers the launch per provider for the next form", () => {
    const remembered = rememberLaunch(
      { provider: "claude", providers: { claude: { model: "sonnet" } } },
      {
        provider: "codex",
        model: "gpt-a",
        thinkingMode: "on",
        effortLevel: "low",
        permissionMode: "plan",
      },
      legacy,
    );
    expect(remembered).toMatchObject({
      provider: "codex",
      permissionMode: "plan",
      providers: {
        claude: { model: "sonnet" },
        codex: { model: "gpt-a", thinkingMode: "on", effortLevel: "low" },
      },
    });
  });

  it("trims typed folders but keeps the root", () => {
    expect(normalizeProjectPath("  ~/Projects/demo/ ")).toBe("~/Projects/demo");
    expect(normalizeProjectPath("/")).toBe("/");
  });
});
