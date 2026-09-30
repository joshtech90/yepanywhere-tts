import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  decodeJsonFrame,
  type RemoteClientMessage,
} from "@yep-anywhere/shared";
import {
  startYaServerProcess,
  disposeYaServerProcess,
} from "./support/ya-server-process";
import { recordUiCapture } from "./support/ui-capture";

test.use({ serviceWorkers: "block" });

test("read toggles stay synchronized across sidebar, session menu and inbox", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const clientPath = dirname(dirname(fileURLToPath(import.meta.url)));
  const projectId = Buffer.from(clientPath).toString("base64url");
  const sessionId = "read-state-session";
  const updatedAt = new Date(Date.now() - 60_000).toISOString();
  const backend = await startYaServerProcess({
    label: "session read state",
    serveBuiltClient: true,
    mockClaudeSession: {
      projectPath: clientPath,
      sessionId,
      content: "Completed session",
      timestamp: updatedAt,
    },
  });
  let hasUnread = false;
  const row = () => ({
    id: sessionId,
    title: "Completed session",
    fullTitle: "Completed session",
    projectId,
    projectName: "Read state",
    provider: "claude",
    ownership: { owner: "none" },
    createdAt: updatedAt,
    updatedAt,
    messageCount: 2,
    hasUnread,
    lastSeenAt: new Date().toISOString(),
  });
  const listeners: Array<(type: string, data: object) => void> = [];
  const setReadState = (unread: boolean) => {
    hasUnread = unread;
    for (const emit of listeners)
      emit("session-seen", {
        type: "session-seen",
        sessionId,
        timestamp: unread ? "" : new Date().toISOString(),
      });
  };
  await page.routeWebSocket("**/api/ws", (socket) => {
    const upstream = socket.connectToServer();
    socket.onMessage((message) => {
      const data =
        typeof message === "string"
          ? (JSON.parse(message) as RemoteClientMessage)
          : decodeJsonFrame<RemoteClientMessage>(message);
      if (data.type === "subscribe" && data.channel === "activity") {
        listeners.push((eventType, payload) =>
          socket.send(
            JSON.stringify({
              type: "event",
              subscriptionId: data.subscriptionId,
              eventType,
              eventId: `read-${Date.now()}-${Math.random()}`,
              data: payload,
            }),
          ),
        );
      }
      upstream.send(message);
    });
  });
  await page.route(/\/api\/sessions(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        sessions: ["starred", "categorized"].some(
          (key) =>
            new URL(route.request().url()).searchParams.get(key) === "true",
        )
          ? []
          : [row()],
        hasMore: false,
      },
    }),
  );
  await page.route(/\/api\/inbox(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        needsAttention: [],
        active: [],
        unread8h: [],
        unread24h: [],
        recentActivity: [
          {
            sessionId,
            projectId,
            projectName: "Read state",
            sessionTitle: "Completed session",
            updatedAt,
            hasUnread,
          },
        ],
      },
    }),
  );
  await page.route(
    /\/api\/projects\/[^/]+\/sessions\/read-state-session(?:\/metadata)?(?:\?|$)/,
    (route) =>
      route.fulfill({
        json: {
          session: row(),
          ownership: { owner: "none" },
          messages: [
            {
              uuid: "user-1",
              type: "user",
              content: "Finish the investigation.",
              timestamp: updatedAt,
            },
            {
              uuid: "assistant-1",
              type: "assistant",
              content: "The work is complete.",
              timestamp: updatedAt,
            },
          ],
        },
      }),
  );
  await page.route("**/api/sessions/read-state-session/process", (route) =>
    route.fulfill({ json: { process: null } }),
  );
  await page.route("**/api/sessions/read-state-session/mark-seen", (route) => {
    setReadState(route.request().method() === "DELETE");
    return route.fulfill({ json: { marked: !hasUnread } });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const origin = backend.baseUrl;
    for (const viewport of [
      { name: "desktop", width: 1000, height: 600 },
      { name: "phone", width: 375, height: 812 },
    ]) {
      hasUnread = false;
      listeners.length = 0;
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/projects/${projectId}/sessions/${sessionId}`);
      await expect(page.locator("[data-composer-input]")).toBeVisible({
        timeout: 30_000,
      });
      await expect.poll(() => listeners.length).toBeGreaterThan(0);
      await page
        .getByRole("button", { name: "Open sidebar", exact: true })
        .click();
      const sidebarRow = page
        .locator(".sidebar:visible .session-list-item")
        .filter({ hasText: "Completed session" })
        .first();
      await expect(sidebarRow).toBeVisible();
      await expect(sidebarRow).not.toHaveClass(/\bunread\b/);
      setReadState(true);
      await expect(sidebarRow).toHaveClass(/\bunread\b/);
      await sidebarRow.locator(".session-menu-trigger").click();
      await page
        .getByRole("button", { name: "Mark as read", exact: true })
        .click();
      await expect(sidebarRow).not.toHaveClass(/\bunread\b/);
      // A later event must supersede the prior manual toggle.
      setReadState(true);
      await expect(sidebarRow).toHaveClass(/\bunread\b/);
      await page
        .getByRole("complementary")
        .getByRole("button", { name: "Close sidebar", exact: true })
        .click();
      const menu = page.locator(".session-header .session-menu-trigger");
      await menu.click();
      await page
        .getByRole("button", { name: "Mark as read", exact: true })
        .click();
      await expect.poll(() => hasUnread).toBe(false);
      setReadState(true);
      await menu.click();
      await expect(
        page.getByRole("button", { name: "Mark as read", exact: true }),
      ).toBeVisible();
      await recordUiCapture(
        page,
        `session-read-state-${viewport.name}`,
        viewport,
      );
      await page
        .getByRole("button", { name: "Mark as read", exact: true })
        .click();
      await page.goto(`${origin}/inbox`);
      const inboxRow = page
        .locator(".session-list-item")
        .filter({ hasText: "Completed session" })
        .last();
      await expect(inboxRow).toBeVisible();
      await expect(inboxRow).not.toHaveClass(/\bunread\b/);
      setReadState(true);
      await expect(inboxRow).toHaveClass(/\bunread\b/);
      setReadState(false);
      await expect(inboxRow).not.toHaveClass(/\bunread\b/);
    }
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await disposeYaServerProcess(backend);
  }
});
