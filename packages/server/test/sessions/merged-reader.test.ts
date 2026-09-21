import type { UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import { MergedSessionReader } from "../../src/sessions/merged-reader.js";
import type {
  ISessionReader,
  SessionListSummary,
} from "../../src/sessions/types.js";

function childReader(options: {
  accepted?: ReturnType<typeof vi.fn>;
}): ISessionReader {
  return {
    listProviderChildSessions: vi.fn(async () => []),
    ...(options.accepted
      ? { listAcceptedProviderChildSessions: options.accepted }
      : {}),
  } as unknown as ISessionReader;
}

describe("MergedSessionReader provider child freshness", () => {
  it("merges latest accepted projections without provider reads", () => {
    const first = vi.fn(() => [
      {
        id: "child-1",
        parentSessionId: "parent",
        updatedAt: "2026-08-05T00:00:00.000Z",
      },
    ]);
    const second = vi.fn(() => [
      {
        id: "child-2",
        parentSessionId: "parent",
        updatedAt: "2026-08-05T00:00:01.000Z",
      },
    ]);
    const reader = new MergedSessionReader([
      childReader({ accepted: first }),
      childReader({ accepted: second }),
    ]);

    // Merged across roots in canonical most-recently-active-first order, not
    // as per-root runs concatenated in reader-authority order.
    expect(reader.listAcceptedProviderChildSessions("parent")).toEqual([
      expect.objectContaining({ id: "child-2" }),
      expect.objectContaining({ id: "child-1" }),
    ]);
    expect(first).toHaveBeenCalledWith("parent");
    expect(second).toHaveBeenCalledWith("parent");
  });

  it("declines the tier when any child reader cannot serve accepted state", () => {
    const reader = new MergedSessionReader([
      childReader({ accepted: vi.fn(() => []) }),
      childReader({}),
    ]);

    expect(reader.listAcceptedProviderChildSessions("parent")).toBeUndefined();
  });

  it("skips an unpublished cold root and keeps a published sibling", () => {
    const published = vi.fn(() => [
      {
        id: "child-1",
        parentSessionId: "parent",
        updatedAt: "2026-08-05T00:00:00.000Z",
      },
    ]);
    const reader = new MergedSessionReader([
      childReader({ accepted: vi.fn(() => undefined) }),
      childReader({ accepted: published }),
    ]);

    expect(reader.listAcceptedProviderChildSessions("parent")).toEqual([
      expect.objectContaining({ id: "child-1" }),
    ]);
    expect(published).toHaveBeenCalledWith("parent");
  });

  it("stays unpublished when every child-capable root is still cold", () => {
    const reader = new MergedSessionReader([
      childReader({ accepted: vi.fn(() => undefined) }),
      childReader({ accepted: vi.fn(() => undefined) }),
    ]);

    expect(reader.listAcceptedProviderChildSessions("parent")).toBeUndefined();
  });
});

describe("MergedSessionReader list summaries", () => {
  const projectId = "proj-merged" as UrlProjectId;
  const hint: SessionListSummary = {
    id: "session-merged",
    projectId,
    title: "Indexed",
    fullTitle: "Indexed",
    updatedAt: "2026-09-01T00:00:00.000Z",
    provider: "codex",
  };

  it("forwards the indexed hint and the question deferral to every root", async () => {
    // A sandbox root that does not hold the session must still receive the
    // hint and the deferral, or the root that answers next reads a tail the
    // caller asked it to skip.
    const sandbox = vi.fn(async () => null);
    const global = vi.fn(async () => ({ ...hint, title: "Answered" }));
    const reader = new MergedSessionReader([
      { getSessionListSummary: sandbox } as unknown as ISessionReader,
      { getSessionListSummary: global } as unknown as ISessionReader,
    ]);

    await expect(
      reader.getSessionListSummary("session-merged", projectId, hint, {
        deferAsyncQuestions: true,
      }),
    ).resolves.toEqual({ ...hint, title: "Answered" });
    for (const root of [sandbox, global]) {
      expect(root).toHaveBeenCalledWith("session-merged", projectId, hint, {
        deferAsyncQuestions: true,
      });
    }
  });

  it("passes an absent hint and absent options through unchanged", async () => {
    const global = vi.fn(async () => hint);
    const reader = new MergedSessionReader([
      { getSessionListSummary: global } as unknown as ISessionReader,
    ]);

    await expect(
      reader.getSessionListSummary("session-merged", projectId),
    ).resolves.toEqual(hint);
    expect(global).toHaveBeenCalledWith(
      "session-merged",
      projectId,
      undefined,
      undefined,
    );
  });
});

describe("MergedSessionReader launch settings recovery", () => {
  it("uses the first authoritative root that contains recovery evidence", async () => {
    const missing = vi.fn(async () => null);
    const recovered = vi.fn(async () => ({
      permissionMode: "bypassPermissions" as const,
      requestedModel: "gpt-5.6-sol",
    }));
    const trailing = vi.fn(async () => ({
      permissionMode: "default" as const,
    }));
    const reader = new MergedSessionReader([
      { getRecoveredLaunchSettings: missing } as unknown as ISessionReader,
      { getRecoveredLaunchSettings: recovered } as unknown as ISessionReader,
      { getRecoveredLaunchSettings: trailing } as unknown as ISessionReader,
    ]);

    await expect(reader.getRecoveredLaunchSettings("session")).resolves.toEqual(
      {
        permissionMode: "bypassPermissions",
        requestedModel: "gpt-5.6-sol",
      },
    );
    expect(missing).toHaveBeenCalledWith("session");
    expect(recovered).toHaveBeenCalledWith("session");
    expect(trailing).not.toHaveBeenCalled();
  });
});
