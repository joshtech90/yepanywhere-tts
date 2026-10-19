// @vitest-environment jsdom

import { afterEach, expect, it } from "vitest";
import { sessionReadShortcut } from "../sessionReadActions";

afterEach(() => document.body.replaceChildren());

function key(target: Element, init: KeyboardEventInit = {}) {
  let result: boolean | null = null;
  target.addEventListener(
    "keydown",
    (event) => {
      result = sessionReadShortcut(event as KeyboardEvent);
    },
    { once: true },
  );
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "u", ...init }));
  return result;
}

it("leaves modified, composing, repeated and already handled keys with their owner", () => {
  for (const init of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
    { repeat: true },
    { key: "x" },
  ])
    expect(key(document.body, init)).toBeNull();
  document.body.addEventListener("keydown", (event) => event.preventDefault(), {
    once: true,
  });
  expect(key(document.body, { cancelable: true })).toBeNull();
  expect(key(document.body)).toBe(true);
  expect(key(document.body, { key: "r" })).toBe(false);
});

it("preserves typing in native/custom editors and interaction inside embedded viewers", () => {
  for (const html of [
    "<input>",
    "<textarea></textarea>",
    "<select></select>",
    "<button></button>",
    '<div contenteditable="true"><span></span></div>',
    '<div role="textbox"><span></span></div>',
    '<div role="combobox"><span></span></div>',
    "<div data-session-read-exclude><span></span></div>",
  ]) {
    document.body.innerHTML = html;
    expect(
      key(
        document.body.querySelector("span") ?? document.body.firstElementChild!,
      ),
    ).toBeNull();
  }
});

it("does not act behind a dialog or menu, including portal content outside the session", () => {
  for (const html of [
    '<div role="dialog"></div>',
    "<dialog open></dialog>",
    '<div role="menu"></div>',
    "<div data-session-menu-open></div>",
  ]) {
    document.body.innerHTML = html;
    expect(key(document.body)).toBeNull();
  }
});
