import { toUrlProjectId } from "@yep-anywhere/shared";

/** Resolve the physical upload directory, including provisional and forked session ids. */
export function getPersistedAttachmentUploadUrl(
  filePath: string | undefined,
  projectId?: string,
): string | null {
  if (!filePath) return null;
  const separator = filePath.includes("\\") ? "\\" : "/";
  const parts = filePath.split(/[\\/]/);
  if (parts.length < 3) return null;
  const filename = parts[parts.length - 1];
  const pathSessionId = parts[parts.length - 2];
  const projectSegment = parts[parts.length - 3];
  if (
    !filename ||
    !pathSessionId ||
    !projectSegment ||
    !/^([0-9a-f-]{36})_/i.test(filename)
  )
    return null;
  if (!projectId) {
    if (projectSegment === ".attachments") {
      const projectPath = parts.slice(0, -3).join(separator);
      if (!projectPath) return null;
      projectId = toUrlProjectId(projectPath);
    } else if (
      projectSegment === "attachments" &&
      parts[parts.length - 4] === ".yep"
    ) {
      const projectPath = parts.slice(0, -4).join(separator);
      if (!projectPath) return null;
      projectId = toUrlProjectId(projectPath);
    } else if (projectSegment === "attachments") return null;
    else projectId = projectSegment;
  }
  return `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(pathSessionId)}/upload/${encodeURIComponent(filename)}`;
}
