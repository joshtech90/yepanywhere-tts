import { describe, expect, it } from "vitest";
import {
  type CockpitShortcutKey,
  resolveCockpitShortcut,
} from "./shortcuts";

function key(
  value: string,
  overrides: Partial<CockpitShortcutKey> = {},
): CockpitShortcutKey {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    key: value,
    metaKey: false,
    repeat: false,
    shiftKey: false,
    target: document.body,
    ...overrides,
  };
}

describe("Cockpit shortcut matrix", () => {
  it.each([
    ["/", false, "search"],
    ["n", false, "new-session"],
    ["r", false, "composer"],
    ["?", false, "help"],
    ["g", false, "navigation-prefix"],
    ["s", true, "sessions"],
    ["p", true, "projects"],
    ["Escape", false, "stop"],
  ] as const)("maps %s with prefix=%s to %s", (value, prefix, action) => {
    expect(resolveCockpitShortcut(key(value), prefix)).toBe(action);
  });

  it("leaves ordinary typing and browser modifier shortcuts alone", () => {
    const input = document.createElement("textarea");
    expect(resolveCockpitShortcut(key("n", { target: input }), false)).toBeNull();
    expect(resolveCockpitShortcut(key("/", { target: input }), false)).toBeNull();
    expect(resolveCockpitShortcut(key("f", { ctrlKey: true }), false)).toBeNull();
    expect(resolveCockpitShortcut(key("r", { metaKey: true }), false)).toBeNull();
    expect(resolveCockpitShortcut(key("n", { repeat: true }), false)).toBeNull();
  });

  it("keeps Escape available for stopping while the composer has focus", () => {
    const input = document.createElement("textarea");
    expect(
      resolveCockpitShortcut(key("Escape", { target: input }), false),
    ).toBe("stop");
  });
});
