import { afterEach, describe, expect, it } from "vitest";
import { programmaticFocus } from "../programmaticFocus";

afterEach(() => {
  document.body.replaceChildren();
});

function mount() {
  const frame = document.createElement("iframe");
  const textarea = document.createElement("textarea");
  document.body.append(frame, textarea);
  return { frame, textarea };
}

describe("programmaticFocus", () => {
  it("leaves focus in an embedded app frame", () => {
    const { frame, textarea } = mount();
    frame.focus();
    expect(document.activeElement).toBe(frame);

    programmaticFocus(textarea);
    expect(document.activeElement).toBe(frame);
  });

  it("focuses when the user is elsewhere in YA", () => {
    const { textarea } = mount();
    programmaticFocus(textarea, { preventScroll: true });
    expect(document.activeElement).toBe(textarea);
  });
});
