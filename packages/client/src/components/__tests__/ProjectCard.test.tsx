// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Project } from "../../types";
import { ProjectCard } from "../ProjectCard";

const project: Project = {
  id: "proj-1",
  name: "test-project",
  path: "/tmp/test-project",
  sessionCount: 0,
  activeOwnedCount: 0,
  activeExternalCount: 0,
  lastActivity: null,
};

function renderProjectCard(onDeleteProject = vi.fn()) {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <ProjectCard
          project={project}
          needsAttentionCount={0}
          thinkingCount={0}
          onDeleteProject={onDeleteProject}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe("ProjectCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("removes the project straight from the trash button", () => {
    const onDeleteProject = vi.fn();
    renderProjectCard(onDeleteProject);

    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));

    expect(onDeleteProject).toHaveBeenCalledWith(project);
  });

  it("offers no removal control without a delete handler", () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={project}
            needsAttentionCount={0}
            thinkingCount={0}
          />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.queryByRole("button", { name: "Remove project" })).toBeNull();
  });

  it("keeps the removal control inert while a removal is in flight", () => {
    const onDeleteProject = vi.fn();
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={project}
            needsAttentionCount={0}
            thinkingCount={0}
            onDeleteProject={onDeleteProject}
            isDeleting
          />
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));

    expect(onDeleteProject).not.toHaveBeenCalled();
  });

  it("commits a longer inline code name on blur", async () => {
    const onUpdateCodeName = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={{ ...project, codeName: "tst" }}
            needsAttentionCount={0}
            thinkingCount={0}
            onUpdateCodeName={onUpdateCodeName}
          />
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit code name" }));
    const input = screen.getByRole("textbox", { name: "Project code name" });
    fireEvent.change(input, { target: { value: "test-code" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onUpdateCodeName).toHaveBeenCalledWith(
        expect.objectContaining({ id: "proj-1" }),
        "test-code",
      );
    });
  });

  it("cancels an inline code-name edit with the x control", () => {
    const onUpdateCodeName = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={{ ...project, codeName: "tst" }}
            needsAttentionCount={0}
            thinkingCount={0}
            onUpdateCodeName={onUpdateCodeName}
          />
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit code name" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Project code name" }),
      { target: { value: "discard-me" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel code name edit" }),
    );

    expect(onUpdateCodeName).not.toHaveBeenCalled();
    expect(screen.getByText("tst")).toBeTruthy();
  });

  it("opens project settings directly from the gear button", () => {
    const onOpenSettings = vi.fn();
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={project}
            needsAttentionCount={0}
            thinkingCount={0}
            onOpenSettings={onOpenSettings}
          />
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open project settings" }),
    );
    expect(onOpenSettings).toHaveBeenCalledWith(project);
  });

  it("shows the derived caption and saves an override with the check", async () => {
    const onUpdateCaption = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={{
              ...project,
              caption: { text: "From the readme.", source: "readme" },
            }}
            needsAttentionCount={0}
            thinkingCount={0}
            onUpdateCaption={onUpdateCaption}
          />
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit caption" }));
    const input = screen.getByRole("textbox", { name: "Project caption" });
    expect((input as HTMLInputElement).value).toBe("From the readme.");
    fireEvent.change(input, { target: { value: "  Custom  caption " } });
    fireEvent.click(screen.getByRole("button", { name: "Save caption" }));

    await waitFor(() => {
      expect(onUpdateCaption).toHaveBeenCalledWith(
        expect.objectContaining({ id: "proj-1" }),
        "Custom caption",
      );
    });
  });

  it("clears an override by saving an empty caption, and cancels with x", async () => {
    const onUpdateCaption = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={{
              ...project,
              caption: { text: "Custom", source: "override" },
            }}
            needsAttentionCount={0}
            thinkingCount={0}
            onUpdateCaption={onUpdateCaption}
          />
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit caption" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project caption" }), {
      target: { value: "discard me" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel caption edit" }),
    );
    expect(onUpdateCaption).not.toHaveBeenCalled();
    expect(screen.getByText("Custom")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit caption" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project caption" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save caption" }));
    await waitFor(() => {
      expect(onUpdateCaption).toHaveBeenCalledWith(
        expect.objectContaining({ id: "proj-1" }),
        null,
      );
    });
  });

  it("offers an add-caption placeholder only when editable", () => {
    const { unmount } = render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={project}
            needsAttentionCount={0}
            thinkingCount={0}
            onUpdateCaption={vi.fn()}
          />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByText("Add a caption")).toBeTruthy();
    unmount();

    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={project}
            needsAttentionCount={0}
            thinkingCount={0}
          />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.queryByText("Add a caption")).toBeNull();
  });

  it("shows a project queue count badge", () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={project}
            needsAttentionCount={0}
            thinkingCount={0}
            queueCount={2}
          />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByTitle("Project Queue items: 2").textContent).toBe("2");
  });

  it("shows a separate warning for a paused queue item", () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectCard
            project={project}
            needsAttentionCount={0}
            thinkingCount={0}
            queueCount={1}
            hasQueueWarning
          />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByTitle("Project Queue items: 1").textContent).toBe("1");
    expect(
      screen.getByLabelText(
        "Project Queue item needs attention. Review or retry it in Project Queue.",
      ).textContent,
    ).toBe("!");
  });
});
