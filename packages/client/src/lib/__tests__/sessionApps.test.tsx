import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  invalidateSessionApps,
  readSessionApps,
  SESSION_APPS_KEY_PREFIX,
  useSessionHasApp,
  writeSessionApps,
} from "../sessionApps";
import type { SessionVhostApp } from "../sessionVhostApps";

const APP: SessionVhostApp = {
  sourceUrl: "http://localhost:7777/",
  url: "https://review.localhost:3400/",
  label: "review",
};

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let position = 0; position < window.localStorage.length; position += 1) {
    const key = window.localStorage.key(position);
    if (key?.startsWith(SESSION_APPS_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

function Chip({
  sessionKey,
  onRender,
}: {
  sessionKey: string;
  onRender?: () => void;
}) {
  const hasApp = useSessionHasApp(sessionKey);
  onRender?.();
  return <span data-testid={sessionKey}>{hasApp ? "app" : "none"}</span>;
}

describe("session apps store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    invalidateSessionApps();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    invalidateSessionApps();
  });

  it("stores nothing for a session with the default value", () => {
    writeSessionApps("/project/session", { dismissed: [] });

    expect(storedKeys()).toEqual([]);
    expect(readSessionApps("/project/session")).toEqual({ dismissed: [] });
  });

  it("removes the key when a session returns to the default", () => {
    writeSessionApps("/project/session", { latest: APP, dismissed: [] });
    expect(storedKeys()).toEqual([
      `${SESSION_APPS_KEY_PREFIX}/project/session`,
    ]);

    writeSessionApps("/project/session", { dismissed: [] });

    expect(storedKeys()).toEqual([]);
    expect(readSessionApps("/project/session").latest).toBeUndefined();
  });

  it("keeps dismissals, which are not the default", () => {
    writeSessionApps("/project/session", { dismissed: ["announcement-1"] });
    invalidateSessionApps();

    expect(readSessionApps("/project/session")).toEqual({
      dismissed: ["announcement-1"],
    });
  });

  it("leaves a row alone when a different session gains an app", () => {
    let renders = 0;
    render(
      <Chip
        sessionKey="/project/quiet"
        onRender={() => {
          renders += 1;
        }}
      />,
    );
    const afterMount = renders;

    act(() => {
      writeSessionApps("/project/loud", { latest: APP, dismissed: [] });
    });

    expect(renders).toBe(afterMount);
  });

  it("re-renders the row whose session gains an app", () => {
    const { getByTestId } = render(<Chip sessionKey="/project/watched" />);
    expect(getByTestId("/project/watched").textContent).toBe("none");

    act(() => {
      writeSessionApps("/project/watched", { latest: APP, dismissed: [] });
    });

    expect(getByTestId("/project/watched").textContent).toBe("app");
  });
});
