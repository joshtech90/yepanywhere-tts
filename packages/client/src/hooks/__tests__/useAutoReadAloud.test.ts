import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const play = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../lib/readAloud", () => ({
  playReadAloud: play,
  stopReadAloud: vi.fn(),
}));

import {
  type LatestAssistantText,
  useAutoReadAloud,
} from "../useAutoReadAloud";

function setup() {
  let latest: LatestAssistantText | null = { key: "m1", text: "Alte Antwort" };
  const hook = renderHook(
    ({ state }: { state: string }) => useAutoReadAloud(state, () => latest),
    { initialProps: { state: "idle" } },
  );
  return {
    setLatest(next: LatestAssistantText | null) {
      latest = next;
    },
    to(state: string) {
      hook.rerender({ state });
    },
  };
}

beforeEach(() => {
  play.mockClear();
  localStorage.setItem("yep-tts-autoread", "1");
});

describe("useAutoReadAloud", () => {
  it("reads the new answer once the turn ends", () => {
    const session = setup();
    session.to("in-turn");
    session.setLatest({ key: "m2", text: "Neue Antwort" });
    session.to("waiting-input");
    session.to("in-turn");
    session.to("idle");
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith("Neue Antwort", "auto");
  });

  it("does not repeat the previous answer after a turn without new text", () => {
    const session = setup();
    // Stopped before any text, or a command such as /compact.
    session.to("in-turn");
    session.to("idle");
    expect(play).not.toHaveBeenCalled();
  });
});
