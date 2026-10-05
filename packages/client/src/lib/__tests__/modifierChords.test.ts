import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installModifierChordTracking,
  lastModifiedKey,
  MODIFIER_COOLDOWN_MS,
  MODIFIER_DELIBERATE_HOLD_MS,
  settleModifier,
} from "../modifierChords";

function press(
  type: "keydown" | "keyup",
  key: string,
  code: string,
  at: number,
  ctrlKey = true,
): KeyboardEvent {
  const event = new KeyboardEvent(type, {
    key,
    code,
    ctrlKey,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "timeStamp", { value: at });
  window.dispatchEvent(event);
  return event;
}

function ctrlVerdict(event: KeyboardEvent): boolean[] {
  const settled: boolean[] = [];
  settleModifier(event, "ctrlKey", (applies) => settled.push(applies));
  return settled;
}

/** Ctrl down, then Ctrl+V released at t=20. */
function pasteReleasedAt20(): void {
  press("keydown", "Control", "ControlLeft", 0);
  press("keydown", "v", "KeyV", 10);
  press("keyup", "v", "KeyV", 20);
}

describe("modifierChords", () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installModifierChordTracking();
  });
  afterEach(() => uninstall());

  it("applies a fresh Ctrl hold even when Ctrl is released first", () => {
    press("keydown", "Control", "ControlLeft", 0);
    const settled = ctrlVerdict(press("keydown", " ", "Space", 10));
    expect(settled).toEqual([true]);
    press("keyup", "Control", "ControlLeft", 20, false);
    expect(settled).toEqual([true]);
  });

  it("spends Ctrl on a key pressed before or just after the previous chord key's release", () => {
    press("keydown", "Control", "ControlLeft", 0);
    press("keydown", "v", "KeyV", 10);
    expect(ctrlVerdict(press("keydown", " ", "Space", 15))).toEqual([false]);
    press("keyup", " ", "Space", 18);
    const rolled = press("keydown", "c", "KeyC", 18 + MODIFIER_COOLDOWN_MS - 1);
    expect(ctrlVerdict(rolled)).toEqual([false]);
    expect(lastModifiedKey()?.code).toBe("KeyC");
  });

  it("applies Ctrl held long past the previous chord key", () => {
    pasteReleasedAt20();
    const space = press(
      "keydown",
      " ",
      "Space",
      20 + MODIFIER_DELIBERATE_HOLD_MS,
    );
    expect(ctrlVerdict(space)).toEqual([true]);
  });

  it("settles a middling gap by which of Space and Ctrl is released first", () => {
    pasteReleasedAt20();
    const deliberate = ctrlVerdict(press("keydown", " ", "Space", 100));
    expect(deliberate).toEqual([]);
    press("keyup", " ", "Space", 150);
    expect(deliberate).toEqual([true]);

    const rolled = ctrlVerdict(press("keydown", " ", "Space", 250));
    expect(rolled).toEqual([]);
    press("keyup", "Control", "ControlLeft", 260, false);
    expect(rolled).toEqual([false]);
  });

  it("starts a fresh hold when Ctrl is pressed anew", () => {
    pasteReleasedAt20();
    press("keydown", "Control", "ControlRight", 25);
    expect(ctrlVerdict(press("keydown", " ", "Space", 30))).toEqual([true]);
  });

  it("reports modifiers as given for events it did not see", () => {
    const unseen = new KeyboardEvent("keydown", { key: " ", ctrlKey: true });
    expect(ctrlVerdict(unseen)).toEqual([true]);
  });
});
