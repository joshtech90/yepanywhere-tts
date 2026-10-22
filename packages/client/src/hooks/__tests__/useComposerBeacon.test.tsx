import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useComposerBeacon } from "../useComposerBeacon";
import { useComposerBeaconPreference } from "../useComposerBeaconPreference";
import {
  useNeedsAttentionBadge,
  toMathematicalBold,
} from "../useNeedsAttentionBadge";
import { invalidateLocalStorageValues } from "../../lib/localStorageValue";
import { UI_KEYS } from "../../lib/storageKeys";
import type { Message } from "../../types";

vi.mock("../../lib/clientSummaryStore", () => ({
  useInboxCounts: () => ({ needsAttention: 2, active: 1 }),
}));
vi.mock("../useTabTitleActivityPreference", () => ({
  useTabTitleActivityPreference: () => ({ tabTitleActivityEnabled: true }),
}));
vi.mock("../useProjectCodeNamePreferences", () => ({
  useProjectCodeNamePreferences: () => ({
    projectCodeNameActivityPulseEnabled: true,
  }),
}));

let textarea: HTMLTextAreaElement;
beforeEach(() => {
  localStorage.removeItem(UI_KEYS.composerBeaconEnabled);
  invalidateLocalStorageValues(UI_KEYS.composerBeaconEnabled);
  document.title = "yep:Session";
  document.querySelector("title")?.setAttribute("data-project-code-name", "");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  textarea = document.createElement("textarea");
  document.body.append(textarea);
});
afterEach(() => {
  cleanup();
  textarea.remove();
  vi.restoreAllMocks();
});

function mount() {
  const controlsRef = {
    current: {
      focus: () => textarea.focus(),
      isFocused: () => document.activeElement === textarea,
    },
  };
  let delivered = false;
  const isMessageDelivered = () => delivered;
  const hook = renderHook(
    ({ sessionKey, messages }: { sessionKey: string; messages: Message[] }) => {
      useNeedsAttentionBadge("💻");
      const begin = useComposerBeacon({
        sessionKey,
        active: true,
        controlsRef,
        messages,
        isMessageDelivered,
      });
      return { begin, ...useComposerBeaconPreference() };
    },
    { initialProps: { sessionKey: "a", messages: [] as Message[] } },
  );
  return {
    ...hook,
    deliver: () => {
      delivered = true;
    },
  };
}

async function arm() {
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "F8",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    ),
  );
  await waitFor(() => expect(document.title).toMatch(/r=[1-9]\d*/));
  return Number(/ r=(\d+)/.exec(document.title)?.[1]);
}

it("preserves formatted titles and acknowledges only the current armed submission", async () => {
  const hook = mount();
  await waitFor(() =>
    expect(document.title).toContain("[YA1 f=0 r=0 a=0 s=idle]"),
  );
  expect(document.title).toContain(
    `(2) 💻 ${toMathematicalBold("yep")}:Session`,
  );
  const first = await arm();
  let complete!: ReturnType<typeof hook.result.current.begin>;
  act(() => {
    complete = hook.result.current.begin({
      tempId: "first",
      content: "first",
      timestamp: new Date().toISOString(),
    });
  });
  await waitFor(() => expect(document.title).toContain("↥ [YA1"));
  const second = await arm();
  expect(second).toBeGreaterThan(first);
  act(() => complete("delivered"));
  await waitFor(() => expect(document.title).toContain("s=delivered]"));
  expect(document.title).toContain(`r=${second} a=0`);
  act(() => {
    complete = hook.result.current.begin({
      tempId: "second",
      content: "second",
      timestamp: new Date().toISOString(),
    });
    complete("queued");
  });
  await waitFor(() =>
    expect(document.title).toContain(
      `◷ [YA1 f=${second} r=${second} a=${second} s=queued]`,
    ),
  );
  hook.deliver();
  hook.rerender({ sessionKey: "a", messages: [] });
  await waitFor(() => expect(document.title).toContain("✓ [YA1"));
  await act(async () => {
    document.title = "yep:Renamed";
  });
  await waitFor(() => expect(document.title).toContain(":Renamed ✓ [YA1"));
  expect(document.title.match(/\[YA1/g)).toHaveLength(1);
  act(() => hook.result.current.setComposerBeaconEnabled(false));
  await waitFor(() => expect(document.title).not.toContain("[YA1"));
  expect(document.title).not.toContain("✓");
  expect(document.title).not.toMatch(/ w=[01]/);
});

it("reports window focus without requiring composer focus or losing title formatting", async () => {
  mount();
  await waitFor(() =>
    expect(document.title).toContain("f=0 r=0 a=0 s=idle] w=1"),
  );
  const request = await arm();
  act(() => window.dispatchEvent(new Event("blur")));
  await waitFor(() => expect(document.title).toContain("r=0 a=0 s=idle] w=0"));
  act(() => {
    textarea.blur();
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() =>
    expect(document.title).toContain(`f=${request} r=0 a=0 s=idle] w=1`),
  );
  expect(document.title.match(/\[YA1/g)).toHaveLength(1);
  expect(document.title.match(/ w=[01]/g)).toHaveLength(1);
});

it("does not acknowledge failures, blurred invocations, or old session completions", async () => {
  const hook = mount();
  await arm();
  let complete!: ReturnType<typeof hook.result.current.begin>;
  act(() => {
    complete = hook.result.current.begin({
      tempId: "x",
      content: "x",
      timestamp: new Date().toISOString(),
    });
    complete("error");
  });
  await waitFor(() => expect(document.title).toContain("a=0 s=error]"));
  act(() => window.dispatchEvent(new Event("blur")));
  act(() => complete("delivered"));
  await waitFor(() => expect(document.title).toContain("r=0 a=0 s=delivered]"));
  await arm();
  act(() => {
    complete = hook.result.current.begin({
      tempId: "old",
      content: "old",
      timestamp: new Date().toISOString(),
    });
  });
  hook.rerender({ sessionKey: "b", messages: [] });
  act(() => complete("delivered"));
  await waitFor(() => expect(document.title).toContain("r=0 a=0 s=idle]"));
});
