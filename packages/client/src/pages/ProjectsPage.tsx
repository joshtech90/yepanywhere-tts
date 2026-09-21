import {
  projectDisplayName,
  PROJECT_CAPTIONS_CAPABILITY,
  PROJECT_CODE_NAMES_CAPABILITY,
  PROJECT_NAMES_CAPABILITY,
  PROJECT_QUEUE_ATTACHMENT_EDITING_CAPABILITY,
  PROJECT_SESSION_DEFAULTS_CAPABILITY,
  type ProjectQueueMessage,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import {
  AddProjectForm,
  type AddProjectRequest,
} from "../components/AddProjectForm";
import formStyles from "../components/AddProjectForm.module.css";
import { PageHeader } from "../components/PageHeader";
import { ProjectCard } from "../components/ProjectCard";
import { ProjectQueueSection } from "../components/ProjectQueueSection";
import { ProjectSessionDefaultsModal } from "../components/ProjectSessionDefaultsModal";
import { useProjectCodeNamePreferences } from "../hooks/useProjectCodeNamePreferences";
import { useProjectQueues } from "../hooks/useProjectQueues";
import { useProjects } from "../hooks/useProjects";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import { MainContent, useNavigationLayout } from "../layouts";
import { useInboxCountsByProject } from "../lib/clientSummaryStore";
import { serverSupportsProjectQueue } from "../lib/projectQueueVisibility";
import type { Project } from "../types";

const EMPTY_PROJECT_QUEUE_PROJECT_IDS: readonly string[] = [];

export function ProjectsPage() {
  const { t } = useI18n();
  const { projects, loading, error, refetch } = useProjects();
  const { version } = useVersion();
  const supportsProjectQueue = serverSupportsProjectQueue(version);
  const supportsProjectQueueAttachmentEditing = serverHasCapability(
    version,
    PROJECT_QUEUE_ATTACHMENT_EDITING_CAPABILITY,
  );
  const supportsProjectSessionDefaults = serverHasCapability(
    version,
    PROJECT_SESSION_DEFAULTS_CAPABILITY,
  );
  const supportsProjectCodeNames = serverHasCapability(
    version,
    PROJECT_CODE_NAMES_CAPABILITY,
  );
  const supportsProjectCaptions = serverHasCapability(
    version,
    PROJECT_CAPTIONS_CAPABILITY,
  );
  const supportsProjectNames = serverHasCapability(
    version,
    PROJECT_NAMES_CAPABILITY,
  );
  const { projectCodeNamesEnabled } = useProjectCodeNamePreferences();
  const inboxCountsByProject = useInboxCountsByProject();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [settingsProject, setSettingsProject] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null,
  );
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const basePath = useRemoteBasePath();
  const highlightedQueueItemId = searchParams.get("queueItem");

  const { openSidebar, isWideScreen } = useNavigationLayout();

  const projectIds = useMemo(
    () => projects.map((project) => project.id),
    [projects],
  );
  const projectQueueProjectIds = supportsProjectQueue
    ? projectIds
    : EMPTY_PROJECT_QUEUE_PROJECT_IDS;
  const projectQueues = useProjectQueues(projectQueueProjectIds);
  const queueStateByProject = useMemo(() => {
    if (!supportsProjectQueue) {
      return new Map<string, { count: number; hasFailed: boolean }>();
    }
    const queueState = new Map<string, { count: number; hasFailed: boolean }>();
    for (const [projectId, items] of Object.entries(
      projectQueues.queuesByProject,
    )) {
      const visibleCount = items.filter(
        (item) => item.status === "queued" || item.status === "failed",
      ).length;
      if (visibleCount > 0) {
        queueState.set(projectId, {
          count: visibleCount,
          hasFailed: items.some((item) => item.status === "failed"),
        });
      }
    }
    return queueState;
  }, [projectQueues.queuesByProject, supportsProjectQueue]);

  // Sort projects: those needing attention first, then by recency
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aNeeds = inboxCountsByProject.get(a.id)?.needsAttention ?? 0;
      const bNeeds = inboxCountsByProject.get(b.id)?.needsAttention ?? 0;

      // Projects needing attention come first
      if (aNeeds > 0 && bNeeds === 0) return -1;
      if (bNeeds > 0 && aNeeds === 0) return 1;

      // Then sort by last activity (most recent first)
      const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bTime - aTime;
    });
  }, [projects, inboxCountsByProject]);

  const handleAddProject = async ({
    path,
    name,
    codeName,
  }: AddProjectRequest) => {
    setAdding(true);
    setAddError(null);

    const finish = (project: Project) => {
      void refetch();
      setShowAddForm(false);
      // A just-added project has no sessions to list, so confirming the
      // form goes straight to starting its first session.
      navigate(
        `${basePath}/new-session?projectId=${encodeURIComponent(project.id)}`,
      );
    };

    try {
      const { project } = await api.addProject(path, { name, codeName });
      finish(project);
    } catch (err) {
      // A path that does not exist yet is offered rather than refused: YA
      // creates the directory as a Git repository with one empty commit,
      // but only after the user says so.
      if ((err as { status?: number }).status === 404) {
        if (confirm(t("projectsCreateConfirm", { path }))) {
          try {
            const { project } = await api.addProject(path, {
              create: true,
              name,
              codeName,
            });
            finish(project);
            return;
          } catch (createErr) {
            setAddError(
              createErr instanceof Error
                ? createErr.message
                : t("projectsAddFailed"),
            );
            return;
          } finally {
            setAdding(false);
          }
        }
      }
      setAddError(err instanceof Error ? err.message : t("projectsAddFailed"));
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (
      !confirm(
        t("projectsDeleteConfirm", { name: projectDisplayName(project) }),
      )
    ) {
      return;
    }

    setDeletingProjectId(project.id);
    setDeleteError(null);

    try {
      await api.deleteProject(project.id);
      await refetch();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : t("projectsDeleteFailed"),
      );
    } finally {
      setDeletingProjectId(null);
    }
  };

  const handleUpdateProjectCodeName = async (
    project: Project,
    codeName: string,
  ) => {
    await api.updateProjectCodeName(project.id, codeName);
    await refetch();
  };

  const handleUpdateProjectCaption = async (
    project: Project,
    caption: string | null,
  ) => {
    await api.updateProjectCaption(project.id, caption);
    await refetch();
  };

  const handleDeleteQueueItem = async (projectId: string, itemId: string) => {
    try {
      await projectQueues.deleteItem(projectId, itemId);
    } catch {
      // The hook exposes the error in the queue section.
    }
  };

  const handleResumeRecoveredQueueItem = async (
    sessionId: string,
    queueId: string,
  ) => {
    try {
      await projectQueues.resumeRecoveredItem(sessionId, queueId);
    } catch {
      // The hook exposes the error in the queue section.
    }
  };

  const handleDeleteRecoveredQueueItem = async (
    sessionId: string,
    queueId: string,
  ) => {
    try {
      await projectQueues.deleteRecoveredItem(sessionId, queueId);
    } catch {
      // The hook exposes the error in the queue section.
    }
  };

  const handlePauseProjectQueue = async () => {
    try {
      await projectQueues.pauseDispatch();
    } catch {
      // The hook exposes the error in the queue section.
    }
  };

  const handleResumeProjectQueue = async () => {
    try {
      await projectQueues.resumeDispatch();
    } catch {
      // The hook exposes the error in the queue section.
    }
  };

  const handlePromoteProjectQueueItem = async (
    projectId: string,
    itemId: string,
    options?: { force?: boolean },
  ) => {
    try {
      await projectQueues.promoteNow(projectId, itemId, options);
    } catch {
      // The hook exposes the error in the queue section.
    }
  };

  const handleRetryQueueItem = async (projectId: string, itemId: string) => {
    try {
      await projectQueues.retryItem(projectId, itemId);
    } catch {
      // The hook exposes the error in the queue section.
    }
  };

  const handleMoveQueueItemToTop = async (
    projectId: string,
    itemId: string,
  ) => {
    try {
      await projectQueues.moveItemToTop(projectId, itemId);
    } catch {
      // The hook exposes the error in the queue section.
    }
  };

  const handleUpdateQueueItem = async (
    projectId: string,
    itemId: string,
    message: ProjectQueueMessage,
  ) => {
    await projectQueues.updateItem(projectId, itemId, { message });
  };

  if (loading) return <div className="loading">{t("projectsLoading")}</div>;
  if (error) {
    return (
      <div className="error">
        {t("projectsErrorPrefix")} {error.message}
      </div>
    );
  }

  const isEmpty = projects.length === 0;

  return (
    <MainContent isWideScreen={isWideScreen}>
      <PageHeader
        title={t("pageTitleProjects")}
        onOpenSidebar={openSidebar}
        isWideScreen={isWideScreen}
      />

      <main className="page-scroll-container">
        <div className="page-content-inner">
          {/* Toolbar with Add Project button */}
          <div className="inbox-toolbar">
            {!showAddForm ? (
              <button
                type="button"
                className="inbox-refresh-button"
                onClick={() => setShowAddForm(true)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t("projectsAdd")}
              </button>
            ) : (
              <AddProjectForm
                projects={projects}
                chooseName={supportsProjectNames}
                chooseCodeName={
                  supportsProjectNames &&
                  supportsProjectCodeNames &&
                  projectCodeNamesEnabled
                }
                adding={adding}
                error={addError}
                onSubmit={(request) => void handleAddProject(request)}
                onCancel={() => {
                  setShowAddForm(false);
                  setAddError(null);
                }}
              />
            )}
          </div>
          {deleteError && <div className={formStyles.error}>{deleteError}</div>}

          {supportsProjectQueue && (
            <ProjectQueueSection
              projects={projects}
              items={projectQueues.items}
              recoveredSessionQueues={projectQueues.recoveredSessionQueues}
              loading={projectQueues.loading}
              error={projectQueues.error}
              mutatingItemId={projectQueues.mutatingItemId}
              mutatingRecoveredQueueId={projectQueues.mutatingRecoveredQueueId}
              mutatingDispatchState={projectQueues.mutatingDispatchState}
              mutatingPromoteItemId={projectQueues.mutatingPromoteItemId}
              dispatchState={projectQueues.dispatchState}
              projectStatusesByProject={projectQueues.projectStatusesByProject}
              highlightedItemId={highlightedQueueItemId}
              basePath={basePath}
              attachmentEditingEnabled={supportsProjectQueueAttachmentEditing}
              onPauseDispatch={handlePauseProjectQueue}
              onResumeDispatch={handleResumeProjectQueue}
              onPromoteNow={handlePromoteProjectQueueItem}
              onDeleteItem={handleDeleteQueueItem}
              onResumeRecoveredItem={handleResumeRecoveredQueueItem}
              onDeleteRecoveredItem={handleDeleteRecoveredQueueItem}
              onRetryItem={handleRetryQueueItem}
              onMoveItemToTop={handleMoveQueueItemToTop}
              onUpdateItem={handleUpdateQueueItem}
            />
          )}

          {isEmpty ? (
            <div className="inbox-empty">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <h3>{t("projectsEmptyTitle")}</h3>
              <p>{t("projectsEmptyDescription")}</p>
            </div>
          ) : (
            <ul className="project-list-cards">
              {sortedProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  needsAttentionCount={
                    inboxCountsByProject.get(project.id)?.needsAttention ?? 0
                  }
                  thinkingCount={
                    inboxCountsByProject.get(project.id)?.active ?? 0
                  }
                  queueCount={queueStateByProject.get(project.id)?.count ?? 0}
                  hasQueueWarning={
                    queueStateByProject.get(project.id)?.hasFailed ?? false
                  }
                  basePath={basePath}
                  onDeleteProject={handleDeleteProject}
                  onOpenSettings={
                    supportsProjectSessionDefaults
                      ? setSettingsProject
                      : undefined
                  }
                  onUpdateCodeName={
                    supportsProjectCodeNames && projectCodeNamesEnabled
                      ? handleUpdateProjectCodeName
                      : undefined
                  }
                  onUpdateCaption={
                    supportsProjectCaptions
                      ? handleUpdateProjectCaption
                      : undefined
                  }
                  isDeleting={deletingProjectId === project.id}
                />
              ))}
            </ul>
          )}
        </div>
      </main>
      {settingsProject && (
        <ProjectSessionDefaultsModal
          projectId={settingsProject.id}
          projectName={settingsProject.name}
          onClose={() => setSettingsProject(null)}
        />
      )}
    </MainContent>
  );
}
