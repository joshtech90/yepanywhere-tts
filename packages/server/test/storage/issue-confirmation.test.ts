import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IssueSettings } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoverySqliteService } from "../../src/storage/discovery-sqlite.js";
import { IssueStore } from "../../src/services/issues/IssueStore.js";
import { IssueConfirmer } from "../../src/services/issues/confirm.js";
import { IssueCredentials } from "../../src/services/issues/credentials.js";
import type { SqliteDatabase, SqliteValue } from "../../src/storage/sqlite.js";
import { storedRows } from "./sqlite-rows.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function harness(overrides: Partial<IssueSettings> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ya-issue-confirm-"));
  directories.push(dir);
  const db = new DiscoverySqliteService({ dataDir: dir, mode: "auto" });
  let settings: IssueSettings = {
    enabled: true,
    scope: "viewed",
    recentDays: 7,
    aggressiveMatching: true,
    confirmation: {
      enabled: true,
      jiraSite: "https://example.atlassian.net",
      jiraEmail: "someone@example.com",
    },
    ...overrides,
  };
  const store = new IssueStore(db.getDatabase()!, () => settings);
  const credentials = new IssueCredentials({
    env: { GITHUB_TOKEN: "gh-secret", JIRA_API_TOKEN: "jira-secret" },
    cliToken: async () => null,
  });
  return {
    db,
    store,
    credentials,
    set: (next: Partial<IssueSettings>) => {
      settings = { ...settings, ...next };
    },
    settings: () => settings,
    capture: (text: string, sessionId = "s") =>
      store.capture(
        { sessionId, projectId: "p" },
        { id: `${sessionId}-${text.length}`, text },
      ),
    pending: () =>
      storedRows(
        store.database,
        "SELECT ref_key,state FROM issue_confirmations ORDER BY ref_key",
      ).map((row) => [String(row.ref_key), String(row.state)]),
  };
}

describe("tracker confirmation", () => {
  it("asks once per newly seen reference and never again on its own", async () => {
    const h = harness();
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/issues/42"))
        return new Response(JSON.stringify({ title: "Repair cancellation" }), {
          status: 200,
        });
      return new Response("", { status: 404 });
    });
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("see https://github.com/Owner/Repo/pull/42 and MADEUP-9");
    expect(h.pending()).toEqual([
      ["MADEUP-9", "pending"],
      ["owner/repo#42", "pending"],
    ]);

    await confirmer.drain();
    expect(h.pending()).toEqual([
      ["MADEUP-9", "rejected"],
      ["owner/repo#42", "confirmed"],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Seeing the same references again, in another session, asks nothing.
    h.capture("still https://github.com/Owner/Repo/pull/42 and MADEUP-9", "s2");
    await confirmer.drain();
    expect(fetcher).toHaveBeenCalledTimes(2);

    const confirmed = h.store
      .list()
      .find((item) => item.key === "owner/repo#42");
    expect(confirmed?.confirmation).toEqual({
      state: "confirmed",
      title: "Repair cancellation",
    });
    expect(
      h.store.list().find((item) => item.key === "MADEUP-9")?.confirmation,
    ).toEqual({ state: "rejected", title: null });
    await confirmer.close();
    h.db.close();
  });

  it("records an unreachable tracker once rather than retrying it", async () => {
    const h = harness();
    const fetcher = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 is the ticket");
    await confirmer.drain();
    expect(h.pending()).toEqual([["PROJ-7", "unreachable"]]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Neither a later drain nor a later sighting asks the tracker again.
    await confirmer.drain();
    h.capture("PROJ-7 again", "s2");
    await confirmer.drain();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Only an explicit recheck does, which is a user action.
    confirmer.recheck("p", "jira", "PROJ-7");
    await confirmer.drain();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await confirmer.close();
    h.db.close();
  });

  it("asks once per reference when a recheck overlaps a drain in flight", async () => {
    const h = harness();
    const asked: string[] = [];
    let release = () => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      asked.push(String(url));
      await inFlight;
      return new Response(
        JSON.stringify({ title: "A pull", fields: { summary: "A ticket" } }),
        { status: 200 },
      );
    });
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 and https://github.com/Owner/Repo/issues/3");

    // A capture starts a drain; the user rechecks while its first lookup is
    // still out. Both references must be asked about once, not once per drain.
    confirmer.schedule();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    confirmer.recheck("p", "jira", "PROJ-7");
    const recheck = confirmer.drain();
    release();
    await recheck;

    expect(asked).toHaveLength(2);
    expect(new Set(asked).size).toBe(2);
    expect(h.pending()).toEqual([
      ["PROJ-7", "confirmed"],
      ["owner/repo#3", "confirmed"],
    ]);
    await confirmer.close();
    h.db.close();
  });

  it("queues nothing while confirmation is off, including a backlog", async () => {
    const h = harness({ confirmation: undefined });
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 and https://github.com/Owner/Repo/issues/1");
    expect(h.pending()).toEqual([]);
    await confirmer.drain();
    expect(fetcher).not.toHaveBeenCalled();

    // Turning it on does not go back over what was captured while it was off.
    h.set({
      confirmation: {
        enabled: true,
        jiraSite: "https://example.atlassian.net",
        jiraEmail: "someone@example.com",
      },
    });
    await confirmer.drain();
    expect(fetcher).not.toHaveBeenCalled();
    await confirmer.close();
    h.db.close();
  });

  it("answers an explicit recheck for a reference captured while it was off", async () => {
    const h = harness({ confirmation: undefined });
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ fields: { summary: "A ticket" } }), {
          status: 200,
        }),
    );
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 is the ticket");
    expect(h.pending()).toEqual([]);

    // The reference holds no row at all, so the user's one way to ask must
    // write one rather than silently updating nothing.
    h.set({
      confirmation: {
        enabled: true,
        jiraSite: "https://example.atlassian.net",
        jiraEmail: "someone@example.com",
      },
    });
    confirmer.recheck("p", "jira", "PROJ-7");
    await confirmer.drain();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(h.pending()).toEqual([["PROJ-7", "confirmed"]]);
    expect(
      h.store.list().find((item) => item.key === "PROJ-7")?.confirmation,
    ).toEqual({ state: "confirmed", title: "A ticket" });
    await confirmer.close();
    h.db.close();
  });

  it("reports a missing credential or Jira site without contacting anything", async () => {
    const h = harness({
      confirmation: {
        enabled: true,
        jiraSite: "",
        jiraEmail: "",
      },
    });
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: new IssueCredentials({
        env: {},
        cliToken: async () => null,
      }),
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 is the ticket");
    await confirmer.drain();
    expect(h.pending()).toEqual([["PROJ-7", "unreachable"]]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      storedRows(h.store.database, "SELECT detail FROM issue_confirmations")[0]!
        .detail,
    ).toContain("No jira credential");
    await confirmer.close();
    h.db.close();
  });

  it("registers a bare Jira key once, not once per question asked about it", () => {
    const dir = mkdtempSync(join(tmpdir(), "ya-issue-confirm-"));
    directories.push(dir);
    const service = new DiscoverySqliteService({ dataDir: dir, mode: "auto" });
    const database = service.getDatabase()!;
    let registrations = 0;
    // Resolving a bare key to a canonical identity registers that identity, so
    // asking the question writes a row. Count those writes: deciding whether a
    // reference is confirmable must not be what pays for one, and a single
    // sighting must not pay twice.
    const counted: SqliteDatabase = {
      ...database,
      prepare(sql: string) {
        const statement = database.prepare(sql);
        if (!/INSERT OR IGNORE INTO external_issues/i.test(sql))
          return statement;
        return {
          ...statement,
          run: (...values: SqliteValue[]) => {
            registrations += 1;
            return statement.run(...values);
          },
        };
      },
    };
    const store = new IssueStore(counted, () => ({
      enabled: true,
      scope: "viewed",
      recentDays: 7,
      // Aggressive matching would answer the confirmation question without
      // consulting the registry at all; off is where both callers resolve.
      aggressiveMatching: false,
      confirmation: {
        enabled: true,
        jiraSite: "https://example.atlassian.net",
        jiraEmail: "someone@example.com",
      },
    }));
    const source = { sessionId: "s", projectId: "p" };
    // One site for the prefix, so a later bare key resolves unambiguously.
    store.capture(source, {
      id: "url",
      text: "https://tracker.test/browse/PROJ-1",
    });
    while (store.processResolutions()) {
      /* Settle namespace learning before measuring the bare key. */
    }

    registrations = 0;
    store.capture(source, { id: "key", text: "PROJ-7 needs a fix" });
    expect(registrations).toBe(1);
    // Paying once still buys the same answer: the resolved key is confirmable,
    // alongside the URL sighting that taught the registry its site.
    expect(
      storedRows(
        store.database,
        "SELECT ref_key,state FROM issue_confirmations ORDER BY ref_key",
      ).map((row) => [String(row.ref_key), String(row.state)]),
    ).toEqual([
      ["PROJ-1", "pending"],
      ["PROJ-7", "pending"],
    ]);
    service.close();
  });

  it("sends Jira basic auth to the configured site and GitHub a bearer token", async () => {
    const h = harness();
    const seen: Array<[string, string]> = [];
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seen.push([String(url), String(headers.Authorization)]);
        return new Response(
          JSON.stringify({ fields: { summary: "A ticket" } }),
          {
            status: 200,
          },
        );
      },
    );
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 and https://github.com/Owner/Repo/issues/3");
    await confirmer.drain();
    const jira = seen.find(([url]) => url.includes("atlassian"))!;
    expect(jira[0]).toBe(
      "https://example.atlassian.net/rest/api/3/issue/PROJ-7?fields=summary",
    );
    expect(
      Buffer.from(jira[1].replace("Basic ", ""), "base64").toString(),
    ).toBe("someone@example.com:jira-secret");
    const github = seen.find(([url]) => url.includes("api.github.com"))!;
    expect(github[0]).toBe("https://api.github.com/repos/owner/repo/issues/3");
    expect(github[1]).toBe("Bearer gh-secret");
    expect(
      h.store.list().find((item) => item.key === "PROJ-7")?.confirmation?.title,
    ).toBe("A ticket");
    await confirmer.close();
    h.db.close();
  });
});
