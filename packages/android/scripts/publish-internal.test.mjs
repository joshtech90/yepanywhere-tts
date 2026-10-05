import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { publishInternal } from "./publish-internal.mjs";

const bundle = Buffer.from("owned signed bundle fixture");
const sourceCommit = "a".repeat(40);
const sha256 = createHash("sha256").update(bundle).digest("hex");

function fixture({ track = "internal", releases = [], uploaded, failAt } = {}) {
  const calls = [];
  const request = async (url, options) => {
    const path = new URL(url).pathname.split("/edits")[1];
    const action = `${options.method} ${path}`;
    calls.push({ action, url, body: options.body });
    assert.equal(options.headers.Authorization, "Bearer test-token");
    if (action === failAt) return new Response("failure", { status: 403 });
    let data = {};
    if (action === "POST ") data = { id: "owned-edit" };
    else if (action === "GET /owned-edit/tracks")
      data = {
        tracks: [
          { track, releases },
          { track: "production", releases: [{ versionCodes: ["200"] }] },
        ],
      };
    else if (action === "GET /owned-edit/bundles")
      data = { bundles: uploaded ? [uploaded] : [] };
    else if (action === "POST /owned-edit/bundles")
      data = { versionCode: 15001, sha256 };
    else if (options.method === "DELETE")
      return new Response(null, { status: 204 });
    return Response.json(data);
  };
  return {
    calls,
    run: (overrides = {}) =>
      publishInternal({
        token: "test-token",
        bundle,
        versionCode: 15001,
        sourceCommit,
        request,
        ...overrides,
      }),
  };
}

test("publishes exact bundle to existing internal track only, validates before commit", async () => {
  const f = fixture();
  const receipt = await f.run();
  assert.equal(receipt.sha256, sha256);
  assert.equal(receipt.status, "published");
  assert.deepEqual(
    f.calls.map(({ action }) => action),
    [
      "POST ",
      "GET /owned-edit/tracks",
      "GET /owned-edit/bundles",
      "POST /owned-edit/bundles",
      "PUT /owned-edit/tracks/internal",
      "POST /owned-edit:validate",
      "POST /owned-edit:commit",
    ],
  );
  const update = JSON.parse(f.calls[4].body);
  assert.equal(update.releases[0].status, "completed");
  assert.deepEqual(update.releases[0].versionCodes, ["15001"]);
  assert.ok(!f.calls.some(({ url }) => /production/.test(url)));
});

test("recognizes Google's qa internal track identifier", async () => {
  const f = fixture({ track: "qa" });
  assert.equal((await f.run()).track, "qa");
});

test("skips already published source even on a later scheduled run", async () => {
  const f = fixture({
    releases: [
      {
        name: `ci ${sourceCommit}`,
        status: "completed",
        versionCodes: ["14001"],
      },
    ],
  });
  assert.equal((await f.run()).status, "unchanged");
  assert.deepEqual(
    f.calls.map(({ action }) => action),
    ["POST ", "GET /owned-edit/tracks", "DELETE /owned-edit"],
  );
});

test("never replaces a newer build or an unsupported track", async () => {
  for (const setup of [
    { releases: [{ versionCodes: ["16001"] }] },
    { track: "beta" },
  ]) {
    const f = fixture(setup);
    await assert.rejects(f.run());
    assert.equal(f.calls.at(-1).action, "DELETE /owned-edit");
    assert.ok(!f.calls.some(({ action }) => action.startsWith("PUT")));
  }
});

test("rejects a reused version with different bundle bytes", async () => {
  const f = fixture({ uploaded: { versionCode: 15001, sha256: "different" } });
  await assert.rejects(f.run(), /SHA-256/);
  assert.ok(!f.calls.some(({ action }) => action.startsWith("PUT")));
});

test("reuses an identical previously uploaded bundle", async () => {
  const f = fixture({ uploaded: { versionCode: 15001, sha256 } });
  assert.equal((await f.run()).status, "published");
  assert.ok(
    !f.calls.some(({ action }) => action === "POST /owned-edit/bundles"),
  );
});

test("failed validation abandons edit without commit or draft fallback", async () => {
  const f = fixture({ failAt: "POST /owned-edit:validate" });
  await assert.rejects(f.run(), /HTTP 403/);
  assert.equal(f.calls.at(-1).action, "DELETE /owned-edit");
  assert.ok(!f.calls.some(({ action }) => action.endsWith(":commit")));
});

test("rejects invalid provenance and version before requesting Play access", async () => {
  const f = fixture();
  for (const overrides of [
    { token: "" },
    { versionCode: 1002 },
    { versionCode: NaN },
    { sourceCommit: "main" },
  ]) {
    await assert.rejects(f.run(overrides));
  }
  assert.equal(f.calls.length, 0);
});
