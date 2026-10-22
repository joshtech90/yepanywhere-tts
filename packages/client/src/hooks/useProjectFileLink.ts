import {
  projectFileLink,
  fromUrlProjectId,
  isUrlProjectId,
  SERVER_CAPABILITIES,
  serverHasCapability,
  type ProjectAppInfo,
} from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { useRetainedVersionInfo } from "./useVersion";
import {
  getProjectRelativePath,
  isAbsoluteLikePath,
  normalizePathSeparators,
} from "../lib/text";

/** Read static link metadata only while a file's copy/share surface is open. */
export function useProjectFileLink(
  target: { projectId: string; path: string; rev?: string } | undefined,
): string | null {
  const { sourceKey, transport } = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(sourceKey);
  const publicShare = usePublicShareContext();
  const projectId = target?.projectId;
  const supported =
    publicShare === null &&
    !target?.rev &&
    serverHasCapability(version, SERVER_CAPABILITIES.projectService.name);
  const [loaded, setLoaded] = useState<{
    projectId: string;
    sourceKey: string;
    links: ProjectAppInfo["fileLinks"];
  } | null>(null);
  useEffect(() => {
    if (!supported || !projectId) return;
    let active = true;
    void transport
      .fetch<ProjectAppInfo>(`/projects/${encodeURIComponent(projectId)}/app`)
      .then(
        (info) => {
          if (active)
            setLoaded({ projectId, sourceKey, links: info.fileLinks });
        },
        () => {
          if (active) setLoaded(null);
        },
      );
    return () => {
      active = false;
    };
  }, [supported, projectId, sourceKey, transport]);
  const relativePath =
    target && isUrlProjectId(target.projectId)
      ? isAbsoluteLikePath(target.path)
        ? getProjectRelativePath(
            target.path,
            fromUrlProjectId(target.projectId),
          )
        : normalizePathSeparators(target.path).replace(/^\.\//, "")
      : null;
  return supported &&
    relativePath &&
    loaded &&
    loaded.projectId === projectId &&
    loaded.sourceKey === sourceKey &&
    loaded.links
    ? projectFileLink(loaded.links, relativePath)
    : null;
}
