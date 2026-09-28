import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";

test.use({ serviceWorkers: "block" });

test("an aborted response after delivery does not restore the sent draft", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(30_000);
  const projectId = Buffer.from(join(e2ePaths.tempDir, "mockproject")).toString(
    "base64url",
  );
  const sessionId = "mock-session-001";
  const timestamp = new Date().toISOString();
  const text = "Check the accepted message without sending it twice.";
  const messages: object[] = [
    { uuid: "first", type: "user", timestamp, content: "Hello" },
  ];
  await page.route(
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
            title: "Send recovery",
            createdAt: timestamp,
            updatedAt: timestamp,
            ownership: { owner: "self", processId: "test-process" },
            messageCount: messages.length,
          },
          ownership: { owner: "self", processId: "test-process" },
          processState: "idle",
          messages,
        },
      }),
  );
  let emit: ((message: object) => void) | undefined;
  await page.routeWebSocket("**/api/ws", (socket) => {
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
        emit = (data) =>
          socket.send(
            JSON.stringify({
              type: "event",
              subscriptionId: frame.subscriptionId,
              eventId: String(eventId++),
              eventType: "message",
              data,
            }),
          );
        socket.send(
          JSON.stringify({
            type: "event",
            subscriptionId: frame.subscriptionId,
            eventId: String(eventId++),
            eventType: "connected",
            data: { sessionId, processId: "test-process", state: "idle" },
          }),
        );
      } else upstream.send(wire);
    });
  });
  let abortResponse: (() => void) | undefined;
  let sends = 0;
  await page.route(`**/api/sessions/${sessionId}/messages`, async (route) => {
    sends++;
    const submitted = route.request().postDataJSON();
    const accepted = {
      uuid: "accepted",
      type: "user",
      tempId: submitted.tempId,
      timestamp: new Date(submitted.clientTimestamp).toISOString(),
      content: submitted.message,
    };
    messages.push(accepted);
    emit?.(accepted);
    const response = {
      uuid: "response",
      type: "assistant",
      timestamp,
      content: "The message was accepted.",
    };
    messages.push(response);
    emit?.(response);
    await new Promise<void>((resolve) => {
      abortResponse = resolve;
    });
    await route.abort("aborted");
  });
  await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
  const input = page.locator("[data-composer-input]").first();
  await expect(input).toBeVisible();
  await expect.poll(() => Boolean(emit)).toBe(true);
  await input.fill(text);
  await input.press("Enter");
  await expect(
    page.getByText("The message was accepted.", { exact: true }),
  ).toBeVisible();
  expect(sends).toBe(1);
  const failed = page.waitForEvent("requestfailed", (request) =>
    request.url().endsWith(`/sessions/${sessionId}/messages`),
  );
  abortResponse?.();
  await failed;
  // Wait for the request catch and React commit before checking failure UI.
  await page.waitForTimeout(250);
  await expect(input).toHaveValue("");
  await expect(page.getByText(/Failed to send message/)).toHaveCount(0);
  expect(sends).toBe(1);
  await page.reload();
  await expect(input).toHaveValue("");
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});
