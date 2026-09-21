import { beforeEach, describe, expect, it, vi } from "vitest";
import { RETAINED_SESSION_COLLECTIONS_CAPABILITY } from "@yep-anywhere/shared";
import type { VersionInfo } from "../../api/client";
import { resolveCollectionRequestMode } from "../collectionRequestMode";
import { asClientSummarySourceKey } from "../clientSummaryStore";

const ensureVersionInfo = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/useVersion", () => ({ ensureVersionInfo }));

const SOURCE = asClientSummarySourceKey("host:request-mode-test");
const OTHER_SOURCE = asClientSummarySourceKey("host:request-mode-other");

function version(capabilities: string[]): VersionInfo {
  return { version: "1.0.0", capabilities } as unknown as VersionInfo;
}

beforeEach(() => {
  ensureVersionInfo.mockReset();
  ensureVersionInfo.mockResolvedValue(
    version([RETAINED_SESSION_COLLECTIONS_CAPABILITY]),
  );
});

describe("resolveCollectionRequestMode", () => {
  it("reads retained summaries from a capable server", async () => {
    await expect(
      resolveCollectionRequestMode(SOURCE, {
        currentSourceKey: () => SOURCE,
      }),
    ).resolves.toBe("retained");
    expect(ensureVersionInfo).toHaveBeenCalledWith(SOURCE);
  });

  it("reads the complete path for a search query", async () => {
    await expect(
      resolveCollectionRequestMode(SOURCE, {
        searchQuery: "needle",
        currentSourceKey: () => SOURCE,
      }),
    ).resolves.toBe("complete");
  });

  it("reads the complete path from a server without the capability", async () => {
    ensureVersionInfo.mockResolvedValue(version([]));
    await expect(
      resolveCollectionRequestMode(SOURCE, {
        currentSourceKey: () => SOURCE,
      }),
    ).resolves.toBe("complete");
  });

  it("abandons a request whose source changed while the version was read", async () => {
    await expect(
      resolveCollectionRequestMode(SOURCE, {
        currentSourceKey: () => OTHER_SOURCE,
      }),
    ).rejects.toThrow("Session source changed");
  });
});
