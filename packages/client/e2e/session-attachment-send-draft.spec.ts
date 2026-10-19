import { join } from "node:path";
import type { Page } from "@playwright/test";
import { e2ePaths, expect, test } from "./fixtures.js";

test.use({ serviceWorkers: "block" });

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const sessionId = "mock-session-001";

/**
 * Two tabs of one session share browser storage. Each tab rehydrates
 * attachment chips when the shared draft changes; that hydration used to
 * rewrite the attachment state with a fresh timestamp, which the other tab saw
 * as a change, so the tabs echoed the draft back and forth. A send with an
 * attachment then kept its text and chip in the composer after delivery, and
 * the server draft was never cleared.
 */
test("a delivered attachment send leaves no draft in either sibling tab", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const projectId = Buffer.from(join(e2ePaths.tempDir, "mockproject")).toString(
    "base64url",
  );
  const timestamp = new Date().toISOString();
  const messages: object[] = [
    { uuid: "first", type: "user", timestamp, content: "Hello" },
  ];
  const emitters: Array<(message: object) => void> = [];

  const openSession = async (tab: Page) => {
    await tab.route(
      new RegExp(
        `/api/projects/[^/]+/sessions/${sessionId}(?:/metadata)?(?:\\?|$)`,
      ),
      (route) =>
        route.fulfill({
          json: {
            session: {
              id: sessionId,
              projectId,
              provider: "claude",
              title: "Attachment send",
              createdAt: timestamp,
              updatedAt: timestamp,
              ownership: { owner: "self", processId: "test-process" },
              messageCount: messages.length,
            },
            ownership: { owner: "self", processId: "test-process" },
            processState: "in-turn",
            messages,
          },
        }),
    );
    await tab.routeWebSocket("**/api/ws", (socket) => {
      const upstream = socket.connectToServer();
      socket.onMessage((wire) => {
        const frame =
          typeof wire === "string"
            ? JSON.parse(wire)
            : wire[0] === 1
              ? JSON.parse(wire.subarray(1).toString())
              : null;
        if (frame?.type === "subscribe" && frame.channel === "session") {
          let eventId = 0;
          emitters.push((data) =>
            socket.send(
              JSON.stringify({
                type: "event",
                subscriptionId: frame.subscriptionId,
                eventId: String(eventId++),
                eventType: "message",
                data,
              }),
            ),
          );
          socket.send(
            JSON.stringify({
              type: "event",
              subscriptionId: frame.subscriptionId,
              eventId: String(eventId++),
              eventType: "connected",
              data: { sessionId, processId: "test-process", state: "in-turn" },
            }),
          );
        } else upstream.send(wire);
      });
    });
    // Delivery appends the attachment list, as the server does.
    await tab.route(`**/api/sessions/${sessionId}/messages`, async (route) => {
      const submitted = route.request().postDataJSON();
      const files = (submitted.attachments ?? []).map(
        (file: { originalName?: string; path?: string }) =>
          `- [${file.originalName}](<${file.path}>)`,
      );
      const accepted = {
        uuid: `accepted-${messages.length}`,
        type: "user",
        timestamp: new Date(submitted.clientTimestamp).toISOString(),
        content: `${submitted.message}\n\nUser uploaded files:\n${files.join("\n")}`,
      };
      messages.push(accepted);
      for (const emit of emitters) emit(accepted);
      await route.fulfill({
        json: { queued: true, serverTimestamp: Date.now() },
      });
    });
    await tab.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
    const input = tab.locator("[data-composer-input]").first();
    await expect(input).toBeVisible();
    return input;
  };

  const input = await openSession(page);
  const sibling = await page.context().newPage();
  const siblingInput = await openSession(sibling);
  await expect.poll(() => emitters.length).toBe(2);
  await page.bringToFront();

  const text = "also too small in the html figure";
  await input.pressSequentially(text, { delay: 10 });
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "image-sd.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  const chip = page.getByRole("button", {
    name: "Remove image-sd.png",
    exact: true,
  });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(siblingInput).toHaveValue(text);
  await input.press("Enter");

  // The echo restored the draft within a second; give it several cycles.
  await page.waitForTimeout(5_000);
  await expect(input).toHaveValue("");
  await expect(chip).toHaveCount(0);
  await expect(siblingInput).toHaveValue("");
});
