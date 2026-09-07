export interface ProjectFileCompletionEntry {
  path: string;
  kind: "file" | "directory";
}

export interface ProjectFileCompletionResult {
  entries: ProjectFileCompletionEntry[];
  pending: boolean;
  truncated: boolean;
}
