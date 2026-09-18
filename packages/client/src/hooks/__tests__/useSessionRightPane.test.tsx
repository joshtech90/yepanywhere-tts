import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import type { Message } from "../../types";
import { invalidateLocalStorageValues } from "../../lib/localStorageValue";
import { UI_KEYS } from "../../lib/storageKeys";
import { useSessionRightPane } from "../useSessionRightPane";
import { clearCurrentSessionViewer } from "../../lib/sessionViewerController";

const config: ArtifactViewerStatus = {
  port: 4402,
  available: true,
  locked: false,
  defaultLocalOrigin: "http://artifacts.localhost",
  localOrigin: "http://artifacts.localhost",
  vhosts: [{ name: "plan", port: 19432 }],
};
const output = (path: string): Message => ({
  content: [
    { type: "tool_result", content: `Open http://localhost:19432/${path}` },
  ],
});

describe("session right pane lifecycle", () => {
  beforeEach(() => {
    clearCurrentSessionViewer();
    localStorage.clear();
    invalidateLocalStorageValues();
  });
  it("offers loaded history without reopening it, then opens fresh output", () => {
    localStorage.setItem(UI_KEYS.sessionRightPane, "true");
    invalidateLocalStorageValues();
    const history = [output("expired")];
    const { result, rerender, unmount } = renderHook(
      ({ messages, active }) =>
        useSessionRightPane("reload", messages, config, active, "reload"),
      { initialProps: { messages: [] as Message[], active: false } },
    );
    rerender({ messages: history, active: true });
    expect(result.current.apps).toHaveLength(1);
    expect(result.current.selected).toBeUndefined();
    act(() => result.current.select(result.current.apps[0]!.url));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.close());
    rerender({ messages: [...history, output("fresh")], active: true });
    expect(result.current.selected?.url).toContain("/fresh");
    act(() => result.current.close());
    unmount();
    const reloaded = renderHook(() =>
      useSessionRightPane("reload", history, config, true, "reload"),
    );
    expect(reloaded.result.current.apps).toHaveLength(1);
    expect(reloaded.result.current.selected).toBeUndefined();
  });
  it("auto-opens a fresh artifact without vhosts and does not open older history", async () => {
    localStorage.setItem(UI_KEYS.sessionRightPane, "true");
    invalidateLocalStorageValues();
    const artifact: Message = {
      uuid: "artifact",
      content: [
        {
          type: "tool_result",
          content: "http://artifacts.localhost/a/token/review.html",
        },
      ],
    };
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useSessionRightPane(
          "artifact",
          messages,
          { ...config, vhosts: [] },
          true,
          "artifact",
        ),
      { initialProps: { messages: [] as Message[] } },
    );
    rerender({ messages: [artifact] });
    expect(result.current.selected?.artifactToken).toBe("token");
    act(() => result.current.close());
    rerender({ messages: [output("older"), artifact] });
    expect(result.current.selected).toBeUndefined();
    act(() => result.current.select(result.current.apps[0]!.url));
    await act(() => result.current.kill());
    expect(result.current.apps).toHaveLength(0);
    expect(result.current.selected).toBeUndefined();
  });
  it("defaults off, retains selectable links, isolates sessions and honors close", () => {
    const messages = [output("one")];
    const { result, rerender } = renderHook(
      ({ key, messages, active, config }) =>
        useSessionRightPane(key, messages, config, active, key),
      { initialProps: { key: "one", messages, active: true, config } },
    );
    expect(result.current.apps).toHaveLength(1);
    expect(result.current.selected).toBeUndefined();
    act(() => {
      localStorage.setItem(UI_KEYS.sessionRightPane, "true");
      invalidateLocalStorageValues();
    });
    act(() => result.current.select(result.current.apps[0]!.url));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.hide());
    expect(result.current.selected).toBeDefined();
    expect(result.current.expanded).toBe(false);
    act(() => result.current.close());
    rerender({ key: "one", messages: [...messages], active: true, config });
    expect(result.current.selected).toBeUndefined();
    rerender({
      key: "one",
      messages: [...messages, output("two")],
      active: false,
      config,
    });
    expect(result.current.apps).toHaveLength(1);
    rerender({
      key: "one",
      messages: [...messages, output("two")],
      active: true,
      config,
    });
    expect(result.current.selected?.url).toContain("/two");
    rerender({
      key: "one",
      messages,
      active: true,
      config: { ...config, vhosts: [] },
    });
    expect(result.current.apps).toHaveLength(0);
    expect(result.current.selected).toBeUndefined();
    rerender({ key: "other", messages: [], active: true, config });
    expect(result.current.apps).toHaveLength(0);
  });
});
