import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import { isAbsoluteLikePath } from "../lib/text";
import { useRetainedVersionInfo } from "./useVersion";

export interface GitHubFileTarget {
  projectId: string;
  path: string;
  origPath?: string;
  rev?: string;
}

export interface GitHubFileLink {
  url: string;
  pushed: boolean;
  dirty: boolean;
}

/** Load GitHub link metadata only for an opened, authenticated file menu. */
export function useGitHubFileLink(
  target: GitHubFileTarget | undefined,
): GitHubFileLink | null {
  const sourceKey = useClientSummarySourceKey();
  const version = useRetainedVersionInfo(sourceKey);
  const publicShare = usePublicShareContext();
  const { projectId, path, origPath, rev } = target ?? {};
  const supported =
    publicShare === null &&
    serverHasCapability(version, SERVER_CAPABILITIES.gitFileRevision.name);
  const canResolveOwner = serverHasCapability(
    version,
    SERVER_CAPABILITIES.fileOwnerProject.name,
  );
  const identity = `${sourceKey}\0${projectId}\0${path}\0${origPath ?? ""}\0${rev ?? ""}`;
  const [loaded, setLoaded] = useState<{
    identity: string;
    value: GitHubFileLink | null;
  } | null>(null);
  useEffect(() => {
    if (!supported || !projectId || !path) return;
    let cancelled = false;
    const load = async () => {
      let owner = { projectId, path };
      if (isAbsoluteLikePath(path) || path.startsWith("~/")) {
        if (!canResolveOwner) return null;
        const result = await api.getFileOwner(projectId, path);
        if (cancelled || !result.owner) return null;
        owner = {
          projectId: result.owner.projectId,
          path: result.owner.relativePath,
        };
      }
      const revision = await api.getGitFileRevision(owner.projectId, {
        path: owner.path,
        origPath,
        rev,
      });
      return revision.githubLink
        ? { ...revision.githubLink, dirty: revision.dirty }
        : null;
    };
    void load()
      .then((value) => {
        if (!cancelled) setLoaded({ identity, value });
      })
      .catch(() => {
        // Optional provenance must not block the existing file actions.
        if (!cancelled) setLoaded({ identity, value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [supported, canResolveOwner, projectId, path, origPath, rev, identity]);
  return supported && loaded?.identity === identity ? loaded.value : null;
}
