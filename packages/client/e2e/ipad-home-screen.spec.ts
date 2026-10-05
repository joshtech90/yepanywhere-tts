/**
 * A limited user's iPad Home Screen launch, over the relay.
 *
 * site/src/content/docs/home-screen.md promises that Safari can add the hosted
 * client as a web app and that, after one sign-in with "Remember me", tapping
 * the icon opens the app without asking again. This checks the parts a browser
 * test can reach: the page offers what Safari's Add to Home Screen reads, and a
 * fresh page at the manifest's start URL resumes the limited user's relay login.
 * The Home Screen itself and its storage separate from Safari are iOS behavior
 * no automated browser reproduces. playwright.ipad.config.ts runs this in
 * WebKit; the main suite runs it in Chromium with the same iPad metrics.
 */

import { devices } from "@playwright/test";
import {
  configureRemoteAccess,
  disableRelay,
  disableRemoteAccess,
  expect,
  test,
  waitForRelayStatus,
} from "./fixtures.js";

const { defaultBrowserType: _browser, ...ipad } = devices["iPad (gen 7)"];
test.use(ipad);

const SERVER_NAME = "e2e-ipad-host";
const OWNER_PASSWORD = "ipad-owner-password-123";
const GUEST = "ipad-guest";
const GUEST_PASSWORD = "ipad-guest-password-123";
const headers = {
  "Content-Type": "application/json",
  "X-Yep-Anywhere": "true",
};

test.describe("iPad Home Screen", () => {
  let previousLimitedUsersEnabled = false;

  test.beforeEach(async ({ baseURL, relayWsURL, request }) => {
    await configureRemoteAccess(baseURL, {
      username: SERVER_NAME,
      password: OWNER_PASSWORD,
      relayUrl: relayWsURL,
    });
    await waitForRelayStatus(baseURL, "waiting", 15_000);
    const settings = await (
      await request.get(`${baseURL}/api/settings`, { headers })
    ).json();
    previousLimitedUsersEnabled = settings.limitedUsersEnabled === true;
    const enabled = await request.put(`${baseURL}/api/settings`, {
      headers,
      data: { limitedUsersEnabled: true },
    });
    expect(enabled.ok(), await enabled.text()).toBe(true);
    const created = await request.post(`${baseURL}/api/users`, {
      headers,
      data: { username: GUEST, password: GUEST_PASSWORD },
    });
    expect(created.status(), await created.text()).toBe(201);
  });

  test.afterEach(async ({ baseURL, request }) => {
    await request.delete(`${baseURL}/api/users/${GUEST}`, { headers });
    await request.put(`${baseURL}/api/settings`, {
      headers,
      data: { limitedUsersEnabled: previousLimitedUsersEnabled },
    });
    await disableRelay(baseURL);
    await disableRemoteAccess(baseURL);
  });

  test("a limited user's relay login resumes from the Home Screen start URL", async ({
    context,
    page,
    remoteClientURL,
    relayWsURL,
  }) => {
    test.setTimeout(60_000);
    await page.goto(remoteClientURL);

    // What Add to Home Screen reads: the icon and a standalone manifest.
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    expect(manifestHref).toBeTruthy();
    const manifestURL = new URL(manifestHref as string, page.url());
    const manifest = await (await page.request.get(manifestURL.href)).json();
    expect(manifest.display).toBe("standalone");
    const startURL = new URL(manifest.start_url, manifestURL).href;

    await page.click('[data-testid="relay-mode-button"]');
    await page.fill('[data-testid="relay-username-input"]', SERVER_NAME);
    await page.fill('[data-testid="srp-password-input"]', GUEST_PASSWORD);
    await expect(
      page.locator('[data-testid="remember-me-checkbox"]'),
    ).toBeChecked();
    // The limited-user identity is an advanced field.
    await page.click("text=Show Advanced Options");
    await page.fill('[data-testid="relay-limited-username-input"]', GUEST);
    await page.fill('[data-testid="custom-relay-url-input"]', relayWsURL);
    await page.click('[data-testid="login-button"]');
    // At iPad portrait width the signed-in app collapses its sidebar.
    await expect(
      page.getByRole("button", { name: "Open sidebar", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    const stored = JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("yep-anywhere-remote-credentials"),
      )) as string,
    );
    expect(stored).toMatchObject({
      mode: "relay",
      relayUsername: SERVER_NAME,
      username: GUEST,
    });
    expect(stored.session).toBeDefined();

    // Tapping the icon opens the start URL in a new page with the app's saved
    // storage; it must resume without showing the login form.
    await page.close();
    const launched = await context.newPage();
    await launched.goto(startURL);
    await expect(
      launched.getByRole("button", { name: "Open sidebar", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      launched.locator('[data-testid="relay-login-form"]'),
    ).toHaveCount(0);
  });
});
