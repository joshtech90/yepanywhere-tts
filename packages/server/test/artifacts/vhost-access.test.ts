import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { VhostAccess } from "../../src/artifacts/VhostAccess.js";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true });
});
const row = { name: "plan", port: 19432 };

it("requires a scoped bearer, strips it upstream and preserves it across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ya-app-access-"));
  directories.push(directory);
  const first = new VhostAccess(directory);
  await first.ready;
  const token = first.token(row);
  expect(token.length).toBeGreaterThanOrEqual(43);
  expect(
    first.authorize(new Request("https://plan.example.org/review"), row),
  ).toBeNull();
  expect(
    first.authorize(
      new Request(
        `https://plan.example.org/review?ya_access=${"é".repeat(43)}`,
      ),
      row,
    ),
  ).toBeNull();
  const accepted = first.authorize(
    new Request(`https://plan.example.org/review?x=1&ya_access=${token}`, {
      headers: {
        cookie: `ya_app_access=${token}; app=hello; yep-anywhere-session=private`,
        authorization: "Bearer private",
        referer: `https://plan.example.org/?ya_access=${token}`,
      },
    }),
    row,
  )!;
  expect(accepted.request.url).toBe("https://plan.example.org/review?x=1");
  expect(accepted.request.headers.get("cookie")).toBe("app=hello");
  expect(accepted.request.headers.get("referer")).toBeNull();
  expect(accepted.request.headers.get("authorization")).toBeNull();
  expect(
    first.authorize(
      new Request("https://plan.example.org/action", {
        method: "POST",
        headers: {
          cookie: `ya_app_access=${token}`,
          origin: "https://stranger.example.org",
        },
      }),
      row,
    ),
  ).toBeNull();
  expect(
    first.authorize(
      new Request("https://plan.example.org/action", {
        method: "POST",
        headers: {
          cookie: `ya_app_access=${token}`,
          origin: "https://plan.example.org",
        },
      }),
      row,
    ),
  ).not.toBeNull();
  expect(accepted.cookie).toContain("HttpOnly; SameSite=None; Secure");
  expect(
    first.authorize(
      new Request("http://plan.example.org/action", {
        method: "POST",
        headers: {
          cookie: `ya_app_access=${token}`,
          origin: "https://plan.example.org",
        },
      }),
      row,
    ),
  ).not.toBeNull();
  const second = new VhostAccess(directory);
  await second.ready;
  expect(second.token(row)).toBe(token);
  expect(
    second.authorize(
      new Request("https://plan.example.org/style.css", {
        headers: { cookie: `ya_app_access=${token}` },
      }),
      row,
    ),
  ).not.toBeNull();
  expect(
    second.authorize(
      new Request(`https://other.example.org/?ya_access=${token}`),
      { ...row, name: "other" },
    ),
  ).toBeNull();
  await second.rotate(row);
  const third = new VhostAccess(directory);
  await third.ready;
  expect(third.token(row)).not.toBe(token);
  expect(
    third.authorize(
      new Request(`https://plan.example.org/?ya_access=${token}`),
      row,
    ),
  ).toBeNull();
  expect(
    third.authorize(new Request("https://plan.example.org/"), {
      ...row,
      public: true,
    }),
  ).not.toBeNull();
});
