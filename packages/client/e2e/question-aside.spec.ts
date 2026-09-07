import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeJsonFrame,
  type RemoteClientMessage,
} from "@yep-anywhere/shared";
import { createServer } from "vite";
import { e2ePaths, expect, test } from "./fixtures.js";

test.use({ serviceWorkers: "block" });

test("question cards use existing forks, keep main typing, and save on empty", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120000);
  const projectId = Buffer.from(join(e2ePaths.tempDir, "mockproject")).toString(
    "base64url",
  );
  const sessionId = "mock-session-001";
  const parentPath = `/api/projects/${projectId}/sessions/${sessionId}`;
  const childId = "question-aside-child";
  const childPath = `/api/projects/${projectId}/sessions/${childId}`;
  let questionPrompt = "";
  let native = true;
  let busy = true;
  let forks = 0;
  let nativeSaves = 0;
  let ordinarySaves = 0;
  let archived = false;
  let publishState: (() => void) | undefined;
  const deferredMessages = [
    {
      id: "queued-main-message",
      content: "Then summarize the results.",
      timestamp: new Date().toISOString(),
      kind: "deferred",
    },
  ];

  await page.addInitScript(() =>
    localStorage.setItem("yep-anywhere-question-asides", "true"),
  );
  await page.route(
    (url) => url.pathname === "/api/version",
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          ...body,
          ...(native
            ? {}
            : { current: "0.8.1", deniedCapabilityBits: [[1, 2 ** 25]] }),
        },
      });
    },
  );
  await page.route(
    (url) => url.pathname.startsWith(parentPath),
    async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("/clone")) {
        forks += 1;
        return route.fulfill({
          json: {
            sessionId: childId,
            messageCount: 1,
            clonedFrom: sessionId,
            provider: "codex",
          },
        });
      }
      if (pathname.endsWith("/conversation-context")) {
        nativeSaves += 1;
        expect(route.request().postDataJSON().turns).toEqual(
          expect.arrayContaining([
            { role: "user", text: "Why is this still running?" },
            {
              role: "assistant",
              text: "The main agent is still running its checks. Saving this answer keeps that context available.",
            },
          ]),
        );
        return route.fulfill({ json: { delivery: "native-history" } });
      }
      if (pathname.endsWith("/reactivate") || pathname.endsWith("/resume")) {
        if (pathname.endsWith("/resume")) ordinarySaves += 1;
        return route.fulfill({
          json: {
            processId: "aside-parent-process",
            permissionMode: "default",
            modeVersion: 1,
            serverTimestamp: Date.now(),
          },
        });
      }
      const response = await route.fetch();
      const body = await response.json();
      return route.fulfill({
        response,
        json: {
          ...body,
          session: { ...body.session, provider: "codex", model: "gpt-6-astra" },
          messages: Array.from({ length: 12 }, (_, index) => ({
            id: `main-${index}`,
            uuid: `main-${index}`,
            type: index % 2 ? "assistant" : "user",
            content:
              index === 11
                ? "Latest live activity: checking the remaining changes."
                : `Check ${index + 1}: review the changes and report progress.`,
          })),
          ownership: { owner: "self", processId: "aside-parent-process" },
          processState: busy ? "in-turn" : "idle",
          deferredMessages,
        },
      });
    },
  );
  await page.route(
    (url) => url.pathname.startsWith(childPath),
    async (route) => {
      if (route.request().method() === "POST") {
        questionPrompt = route.request().postDataJSON().message;
        return route.fulfill({
          json: {
            processId: "aside-child-process",
            permissionMode: "default",
            modeVersion: 1,
            serverTimestamp: Date.now(),
          },
        });
      }
      return route.fulfill({
        json: {
          session: {
            id: childId,
            projectId,
            provider: "codex",
            title: "Quick answer",
            isArchived: true,
          },
          ownership: { owner: "none" },
          messages: [
            {
              id: "question",
              uuid: "question",
              type: "user",
              content: questionPrompt,
            },
            {
              id: "answer",
              uuid: "answer",
              type: "assistant",
              content:
                "The main agent is still running its checks. Saving this answer keeps that context available.",
            },
          ],
        },
      });
    },
  );
  await page.route(`**/api/sessions/${childId}/metadata`, async (route) => {
    archived = route.request().postDataJSON().archived === true;
    await route.fulfill({ json: { updated: true } });
  });
  await page.route(`**/api/sessions/${childId}/process`, async (route) => {
    await route.fulfill({ json: { process: null } });
  });
  await page.route("**/api/onboarding", (route) =>
    route.fulfill({ json: { complete: true } }),
  );
  await page.routeWebSocket("**/api/ws", (socket) => {
    const upstream = socket.connectToServer();
    socket.onMessage((message) => {
      const payload =
        typeof message === "string"
          ? (JSON.parse(message) as RemoteClientMessage)
          : decodeJsonFrame<RemoteClientMessage>(message);
      if (
        payload.type === "subscribe" &&
        payload.channel === "session" &&
        payload.sessionId === sessionId
      ) {
        const sendState = (eventType: string) =>
          socket.send(
            JSON.stringify({
              type: "event",
              subscriptionId: payload.subscriptionId,
              eventType,
              eventId: `question-${busy}`,
              data: {
                sessionId,
                state: busy ? "in-turn" : "idle",
                permissionMode: "default",
                modeVersion: 1,
                deferredMessages,
              },
            }),
          );
        publishState = () => sendState("status");
        sendState("connected");
        return;
      }
      upstream.send(message);
    });
  });

  const server = await createServer({
    configFile: join(
      dirname(fileURLToPath(import.meta.url)),
      "../vite.config.ts",
    ),
    define: { __VITE_DEV_PORT__: "-1" },
    server: {
      port: 0,
      host: "127.0.0.1",
      proxy: { "/api": { target: baseURL, ws: true } },
    },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("Missing Vite port");
    const captureDir = process.env.YEP_E2E_UI_CAPTURE_DIR;
    if (captureDir) mkdirSync(captureDir, { recursive: true });
    const device = await page.context().newCDPSession(page);
    for (const viewport of [
      { name: "desktop", width: 1000, height: 600 },
      { name: "phone", width: 375, height: 812 },
    ]) {
      native = viewport.name === "desktop";
      busy = true;
      await device.send("Emulation.setTouchEmulationEnabled", {
        enabled: !native,
      });
      await page.setViewportSize(viewport);
      await page.goto(
        `http://127.0.0.1:${address.port}/projects/${projectId}/sessions/${sessionId}`,
      );
      const composer = page.locator("[data-composer-input]");
      await expect(composer).toBeVisible({ timeout: 30000 });
      await composer.fill("Why is this still running?");
      const hint = page.getByText(
        `${native ? "Enter" : "Send"}: quick answer · Space: keep typing`,
      );
      await expect(hint).toBeVisible();
      if (captureDir)
        await page.screenshot({
          path: join(captureDir, `${viewport.name}-hint.png`),
        });
      await composer.fill("Why is this still running? ");
      await expect(hint).toHaveCount(0);
      await composer.fill("Why is this still running?");
      if (native) await composer.press("Enter");
      else
        await page
          .locator(".message-input-wrapper")
          .getByRole("button", { name: "Quick answer", exact: true })
          .click();
      const card = page.getByRole("region", { name: "Quick answer" });
      await expect(card.getByRole("button", { name: "Save Q+A" })).toBeEnabled({
        timeout: 15000,
      });
      expect(archived).toBe(true);
      await expect(composer).toHaveValue("");
      await composer.fill("My next main message");
      await expect(card).toBeVisible();
      await composer.fill("");
      await expect(card.getByRole("heading")).toHaveCount(0);
      const queue = page.getByText("Then summarize the results.", {
        exact: true,
      });
      await expect(queue).toBeVisible();
      const queueBox = await queue.boundingBox();
      const cardBox = await card.boundingBox();
      const composerBox = await composer.boundingBox();
      expect(queueBox!.y + queueBox!.height).toBeLessThanOrEqual(cardBox!.y);
      expect(cardBox!.y + cardBox!.height).toBeLessThan(composerBox!.y);
      await expect(queue).toBeInViewport();
      await expect
        .poll(() =>
          page
            .locator("main.session-messages")
            .evaluate(
              (element) =>
                element.scrollHeight - element.scrollTop - element.clientHeight,
            ),
        )
        .toBeLessThan(3);
      if (captureDir)
        await page.screenshot({
          path: join(captureDir, `${viewport.name}-answer.png`),
        });
      await card
        .getByRole("button", { name: "Quick answer", exact: true })
        .click();
      await expect(card.getByRole("tooltip")).toBeVisible();
      await card
        .getByRole("button", { name: "Quick answer", exact: true })
        .click();
      if (native) await composer.press("Enter");
      else
        await page
          .locator(".message-input-wrapper")
          .getByRole("button", { name: "Save Q+A", exact: true })
          .click();
      await expect(card).toHaveCount(0);
    }
    expect(forks).toBe(2);
    expect(nativeSaves).toBe(1);
    expect(ordinarySaves).toBe(1);
    busy = false;
    publishState?.();
    await page.locator("[data-composer-input]").fill("Idle question?");
    await expect(
      page.getByText("Send: quick answer · Space: keep typing"),
    ).toHaveCount(0);
  } finally {
    await page.close();
    await server.close();
  }
});
