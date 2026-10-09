import type { SessionClientView } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import { createSessionViewRoutes } from "../../src/routes/session-view.js";
import { SessionViewRegistry } from "../../src/services/SessionViewRegistry.js";

function harness() {
  const changes: Array<{ sessionId: string; views: SessionClientView[] }> = [];
  let tick = 0;
  const registry = new SessionViewRegistry(
    (sessionId, views) => changes.push({ sessionId, views: [...views] }),
    () => new Date(Date.UTC(2026, 9, 6, 10, 0, tick++)),
  );
  const routes = createSessionViewRoutes({ sessionViews: registry });
  const put = (sessionId: string, body: unknown) =>
    routes.request(`/${sessionId}/view`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { changes, registry, routes, put };
}

const fileViewer = {
  kind: "file",
  label: "README.md",
  target: "README.md:12",
  openedBy: "user",
  state: "minimized",
  placement: "covering",
};

describe("session view routes", () => {
  it("keeps each tab separate and remembers focus across unfocused reports", async () => {
    const { changes, registry, put } = harness();
    expect(
      (
        await put("s1", {
          clientId: "a",
          device: "Mac",
          focused: true,
          viewers: [fileViewer],
          extra: "dropped",
        })
      ).status,
    ).toBe(200);
    await put("s1", {
      clientId: "b",
      device: "iPhone",
      focused: false,
      viewers: [],
    });
    await put("s1", {
      clientId: "a",
      device: "Mac",
      focused: false,
      viewers: [],
    });
    const views = registry.views("s1");
    expect(views).toHaveLength(2);
    const a = views.find((view) => view.clientId === "a");
    expect(a).toMatchObject({
      focused: false,
      viewers: [],
      focusedAt: "2026-10-06T10:00:00.000Z",
      publishedAt: "2026-10-06T10:00:02.000Z",
    });
    expect(a).not.toHaveProperty("extra");
    expect(views.find((view) => view.clientId === "b")?.focusedAt).toBeNull();
    expect(changes.map((change) => change.views.length)).toEqual([1, 2, 2]);
  });

  it("rejects malformed reports without recording them", async () => {
    const { changes, put } = harness();
    for (const body of [
      { clientId: "", device: "Mac", focused: true, viewers: [] },
      { clientId: "a", device: "Mac", focused: "yes", viewers: [] },
      {
        clientId: "a",
        device: "Mac",
        focused: true,
        viewers: [{ ...fileViewer, kind: "terminal" }],
      },
      {
        clientId: "a",
        device: "Mac",
        focused: true,
        viewers: Array(5).fill(fileViewer),
      },
    ])
      expect((await put("s1", body)).status).toBe(400);
    expect(changes).toEqual([]);
  });

  it("forgets a departed tab and ignores an unknown one", async () => {
    const { changes, registry, routes, put } = harness();
    await put("s1", {
      clientId: "a",
      device: "Mac",
      focused: true,
      viewers: [],
    });
    await routes.request("/s1/view/unknown", { method: "DELETE" });
    expect(changes).toHaveLength(1);
    await routes.request("/s1/view/a", { method: "DELETE" });
    expect(registry.views("s1")).toEqual([]);
    expect(changes.at(-1)).toEqual({ sessionId: "s1", views: [] });
  });

  it("bounds tabs per session, dropping the least recently reported", async () => {
    const { registry, put } = harness();
    for (let index = 0; index < 10; index += 1)
      await put("s1", {
        clientId: `tab-${index}`,
        device: "Linux",
        focused: false,
        viewers: [],
      });
    const ids = registry.views("s1").map((view) => view.clientId);
    expect(ids).toHaveLength(8);
    expect(ids).not.toContain("tab-0");
    expect(ids).toContain("tab-9");
  });
});
