import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useGitHubFileLink } from "../useGitHubFileLink";

const state = vi.hoisted(() => ({
  source: "local",
  capabilities: ["git-file-revision", "file-owner-project"],
  publicShare: null as unknown,
  revision: vi.fn(),
  owner: vi.fn(),
}));
vi.mock("../../api/client", () => ({
  api: { getGitFileRevision: state.revision, getFileOwner: state.owner },
}));
vi.mock("../../lib/clientSummaryStore", () => ({
  useClientSummarySourceKey: () => state.source,
}));
vi.mock("../useVersion", () => ({
  useRetainedVersionInfo: () => ({
    current: "0.0.0-dev",
    capabilities: state.capabilities,
  }),
}));
vi.mock("../../contexts/PublicShareContext", () => ({
  usePublicShareContext: () => state.publicShare,
}));

const target = { projectId: "project", path: "file.txt" };
const githubLink = {
  url: "https://github.com/me/repo/blob/1234/file.txt",
  pushed: true,
};
beforeEach(() => {
  state.source = "local";
  state.capabilities = ["git-file-revision", "file-owner-project"];
  state.publicShare = null;
  state.revision.mockReset().mockResolvedValue({ githubLink, dirty: true });
  state.owner.mockReset();
});

it("loads the existing route and adds its dirty state", async () => {
  const { result } = renderHook(() => useGitHubFileLink(target));
  await waitFor(() =>
    expect(result.current).toEqual({ ...githubLink, dirty: true }),
  );
  expect(state.revision).toHaveBeenCalledWith("project", {
    path: "file.txt",
    origPath: undefined,
    rev: undefined,
  });
});

it("omits the action on older responses without metadata", async () => {
  state.revision.mockResolvedValue({ dirty: false });
  const { result } = renderHook(() => useGitHubFileLink(target));
  await act(async () => {});
  expect(state.revision).toHaveBeenCalledTimes(1);
  expect(result.current).toBeNull();
});

it.each(["no capability", "public share", "no target"])(
  "makes no request with %s",
  async (kind) => {
    if (kind === "no capability") state.capabilities = [];
    if (kind === "public share") state.publicShare = {};
    renderHook(() =>
      useGitHubFileLink(kind === "no target" ? undefined : target),
    );
    await act(async () => {});
    expect(state.revision).not.toHaveBeenCalled();
    expect(state.owner).not.toHaveBeenCalled();
  },
);

it("resolves home paths to their owning project", async () => {
  state.owner.mockResolvedValue({
    owner: { projectId: "other", relativePath: "file.txt" },
  });
  const { result } = renderHook(() =>
    useGitHubFileLink({ ...target, path: "~/other/file.txt" }),
  );
  await waitFor(() => expect(result.current?.pushed).toBe(true));
  expect(state.revision).toHaveBeenCalledWith(
    "other",
    expect.objectContaining({ path: "file.txt" }),
  );
});

it("does not send an unsupported owner lookup", async () => {
  state.capabilities = ["git-file-revision"];
  renderHook(() => useGitHubFileLink({ ...target, path: "/other/file.txt" }));
  await act(async () => {});
  expect(state.owner).not.toHaveBeenCalled();
  expect(state.revision).not.toHaveBeenCalled();
});

it("discards a previous source's response", async () => {
  let finish!: (value: unknown) => void;
  state.revision.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result, rerender } = renderHook(() => useGitHubFileLink(target));
  state.source = "remote";
  state.revision.mockResolvedValue({
    githubLink: { ...githubLink, pushed: false },
    dirty: false,
  });
  rerender();
  await waitFor(() => expect(result.current?.pushed).toBe(false));
  await act(async () => {
    finish({ githubLink, dirty: true });
  });
  expect(result.current?.pushed).toBe(false);
});
