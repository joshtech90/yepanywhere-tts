import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPageRecovery } from "./acceptance.mjs";

function recovered() {
  return {
    client: "android",
    surface: "session",
    completed: true,
    instrumentationPassed: true,
    faultAt: 10,
    restoredAt: 20,
    firstHealthyAt: 30,
    expectedPath: "/sessions/one",
    final: {
      path: "/sessions/one",
      titleUpdated: true,
      needle: true,
      draft: "Draft survives outage",
    },
    sidebar: { sidebar: "Updated study" },
    observer: {
      rows: [{ at: 30, path: "/sessions/one" }],
      keys: [..."Draft survives outage"].map((_, index) => ({
        value: "Draft survives outage".slice(0, index + 1),
        frameDelayMs: 8,
        eventDelayMs: 1,
      })),
    },
  };
}
test("accepts recovered session and inbox without treating completion as acceptance", () => {
  const result = recovered();
  assert.equal(assessPageRecovery(result).passed, true);
  result.surface = "inbox";
  delete result.final.draft;
  delete result.final.needle;
  assert.equal(assessPageRecovery(result).passed, true);
  delete result.firstHealthyAt;
  assert.equal(assessPageRecovery(result).passed, false);
});
test("rejects transient errors and login even when the final page looks healthy", () => {
  for (const transient of [
    { errors: "API error: 503" },
    { login: true },
    { path: "/hosts/home/login" },
    { bodyEmpty: true },
  ]) {
    const result = recovered();
    result.observer.rows.unshift({ at: 21, ...transient });
    assert.equal(assessPageRecovery(result).passed, false);
  }
});
test("attachment identity uses the full accessible name, not truncated chip text", () => {
  const result = recovered();
  result.expectedAttachment = "a-long-attachment-filename.bin";
  result.final.attachments = "a-long...4 mb";
  result.final.attachmentNames = [result.expectedAttachment];
  assert.equal(assessPageRecovery(result).passed, true);
  result.final.attachmentNames = [];
  assert.equal(assessPageRecovery(result).passed, false);
});
test("separates new-document bootstrap from a rendered page becoming empty", () => {
  const result = recovered();
  result.observer.rows.unshift({ at: 21, bodyEmpty: true, initializing: true });
  assert.equal(assessPageRecovery(result).passed, true);
  result.observer.rows.push({ at: 31, bodyEmpty: true, initializing: false });
  assert.equal(assessPageRecovery(result).passed, false);
});
test("rejects lost drafts, stale views, missing evidence and incomplete cleanup", () => {
  const changes = [
    (r) => {
      r.final.draft = "";
    },
    (r) => {
      r.expectedAttachment = "draft.txt";
      r.final.attachments = "";
    },
    (r) => {
      r.final.needle = false;
    },
    (r) => {
      r.final.titleUpdated = false;
    },
    (r) => {
      r.sidebar.sidebar = "Old title";
    },
    (r) => {
      r.observer.rows = [];
    },
    (r) => {
      r.completed = false;
    },
    (r) => {
      r.instrumentationPassed = false;
    },
    (r) => {
      r.final.path = "/projects";
    },
    (r) => {
      r.nativeSyntheticErrors = ["Synthetic 503"];
    },
    (r) => {
      r.observer.keys.splice(2, 1);
    },
    (r) => {
      r.observer.keys[0].frameDelayMs = 101;
    },
  ];
  for (const change of changes) {
    const result = recovered();
    change(result);
    assert.equal(assessPageRecovery(result).passed, false);
  }
});
