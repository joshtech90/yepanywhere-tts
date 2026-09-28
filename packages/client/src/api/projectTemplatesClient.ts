import { fetchJSON } from "./sourceApiFetch";
import type { StagedAttachmentRef } from "@yep-anywhere/shared";

export interface ProjectTemplateChoice {
  id: string;
  sourceId: string;
  title: string;
  description: string;
  icon?: string;
  preview?: string;
}
export interface ProjectTemplateChoices {
  enabled: boolean;
  templates: ProjectTemplateChoice[];
}
export interface TemplateCreationRequest {
  operationId: string;
  sourceId: string;
  templateId: string;
  path: string;
  name: string;
  intent: string;
  stagedAttachments?: { batchId: string; refs: StagedAttachmentRef[] };
  session: Record<string, unknown>;
}
export interface TemplateCreationOperation {
  request: TemplateCreationRequest;
  phase:
    | "materializing"
    | "setup"
    | "registering"
    | "preparing"
    | "started"
    | "failed"
    | "interrupted";
  log: string;
  projectId?: string;
  sessionId?: string;
  error?: string;
}
export const projectTemplatesApi = {
  choices: (signal?: AbortSignal) =>
    fetchJSON<ProjectTemplateChoices>("/project-templates/choices", { signal }),
  create: (request: TemplateCreationRequest) =>
    fetchJSON<TemplateCreationOperation>("/project-templates/operations", {
      method: "POST",
      body: JSON.stringify(request),
    }),
  operation: (id: string, signal?: AbortSignal) =>
    fetchJSON<TemplateCreationOperation>(
      `/project-templates/operations/${encodeURIComponent(id)}`,
      { signal },
    ),
};
