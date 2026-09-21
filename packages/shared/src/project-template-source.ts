export interface ProjectTemplateSourceConfig {
  id: string;
  repository: string;
  contentPath: string;
  revision: string;
}

export const DEFAULT_PROJECT_TEMPLATE_SOURCE: ProjectTemplateSourceConfig = {
  id: "ya-default",
  repository: "https://github.com/graehl/agents",
  contentPath: "project-templates",
  revision: "HEAD",
};

export interface ProjectTemplateSourcesConfig {
  enabled: boolean;
  sources: ProjectTemplateSourceConfig[];
}

export const DEFAULT_PROJECT_TEMPLATE_SOURCES: ProjectTemplateSourcesConfig = {
  enabled: false,
  sources: [{ ...DEFAULT_PROJECT_TEMPLATE_SOURCE }],
};

export interface ProjectTemplateSourceSnapshot
  extends ProjectTemplateSourceConfig {
  commit: string | null;
  /** Local working files are mutable; commit identifies their Git HEAD only. */
  local?: boolean;
  rawDirectory: string;
  directory: string;
  rewrittenFiles: number;
}

export interface ProjectTemplateSourceState {
  config: ProjectTemplateSourcesConfig;
  phase: "disabled" | "fetching" | "ready" | "error";
  error?: string;
  result?: "updated" | "up-to-date";
  snapshot?: {
    sources: ProjectTemplateSourceSnapshot[];
    templates: {
      id: string;
      sourceId: string;
      title: string;
      description: string;
      status: "draft" | "ready";
    }[];
  };
}
