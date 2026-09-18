import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

const projectId = Buffer.from(join(e2ePaths.tempDir, "mockproject")).toString(
  "base64url",
);
const sessionId = "mock-session-001";

test.use({ serviceWorkers: "block" });

for (const viewport of [
  { name: "desktop", width: 1200, height: 600 },
  { name: "phone", width: 375, height: 812 },
]) {
  test(`catch-up places user turns before a live reply on ${viewport.name}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const timestamp = "2026-09-15T05:00:00.000Z";
    const row = (
      uuid: string,
      type: "user" | "assistant",
      content: string,
    ) => ({
      uuid,
      type,
      timestamp,
      message: { role: type, content },
    });
    const prefix = row("prefix", "user", "Check the earlier result.");
    const first = row("user-1", "user", "Include the omitted cases.");
    const second = row("user-2", "user", "Keep the sample representative.");
    const reply = row(
      "reply",
      "assistant",
      "I will check both requested changes.",
    );
    let caughtUp = false;
    await page.route(
      new RegExp(
        `/api/projects/[^/]+/sessions/${sessionId}(?:/metadata)?(?:\\?|$)`,
      ),
      (route) => {
        const ownership = caughtUp
          ? { owner: "none" }
          : { owner: "self", processId: "catchup-process" };
        return route.fulfill({
          json: {
            session: {
              id: sessionId,
              projectId,
              provider: "codex",
              title: "Catch-up order",
              createdAt: timestamp,
              updatedAt: timestamp,
              ownership,
              messageCount: caughtUp ? 4 : 1,
            },
            ownership,
            messages: caughtUp ? [prefix, first, second, reply] : [prefix],
          },
        });
      },
    );
    let emit: ((eventType: string, data: object) => void) | undefined;
    await page.routeWebSocket("**/api/ws", (socket) => {
      const upstream = socket.connectToServer();
      socket.onMessage((wire) => {
        const payload =
          typeof wire === "string" ? wire : wire.subarray(1).toString("utf8");
        const message = JSON.parse(payload);
        if (message.type === "subscribe" && message.channel === "session") {
          let eventId = 0;
          emit = (eventType, data) =>
            socket.send(
              JSON.stringify({
                type: "event",
                subscriptionId: message.subscriptionId,
                eventId: String(eventId++),
                eventType,
                data,
              }),
            );
          emit("connected", {
            sessionId,
            processId: "catchup-process",
            state: "in-turn",
          });
          return;
        }
        upstream.send(wire);
      });
    });
    const versionResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/version" && response.ok(),
    );
    await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
    await versionResponse;
    // Let capability discovery commit before exercising the aligned-ID path.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const onboarding = page.getByText("Welcome to yepanywhere");
    if (await onboarding.isVisible())
      await page.getByRole("button", { name: "Skip all" }).click();
    const main = page.getByRole("main");
    await expect(
      main.getByText(prefix.message.content, { exact: true }),
    ).toBeVisible();
    await expect.poll(() => Boolean(emit)).toBe(true);
    emit?.("message", reply);
    await expect(
      main.getByText(reply.message.content, { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText(first.message.content, { exact: true }),
    ).toHaveCount(0);
    caughtUp = true;
    emit?.("complete", { sessionId });
    const composer = page.locator("[data-composer-input]");
    let draft = "";
    for (const character of "Follow up") {
      draft += character;
      await composer.pressSequentially(character);
      await expect(composer).toHaveValue(draft, { timeout: 100 });
    }
    const firstRow = main.getByText(first.message.content, { exact: true });
    const secondRow = main.getByText(second.message.content, { exact: true });
    const replyRow = main.getByText(reply.message.content, { exact: true });
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();
    await expect(replyRow).toHaveCount(1);
    const firstBox = await firstRow.boundingBox();
    const secondBox = await secondRow.boundingBox();
    const replyBox = await replyRow.boundingBox();
    expect(firstBox!.y).toBeLessThan(secondBox!.y);
    expect(secondBox!.y).toBeLessThan(replyBox!.y);
    await recordUiCapture(page, `catchup-order-${viewport.name}`, viewport);
  });
}
