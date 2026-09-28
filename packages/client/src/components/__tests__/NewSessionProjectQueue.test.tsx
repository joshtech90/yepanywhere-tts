// @vitest-environment jsdom

import type { ProjectQueueItemSummary } from "@yep-anywhere/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { NewSessionProjectQueue } from "../NewSessionProjectQueue";

function renderQueue(
  error: Error | null,
  items: readonly ProjectQueueItemSummary[] = [],
) {
  return render(
    <I18nProvider>
      <NewSessionProjectQueue
        items={items}
        loading={false}
        error={error}
        onOpenItem={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("NewSessionProjectQueue", () => {
  afterEach(cleanup);

  it("hides a confirmed empty queue", () => {
    const view = renderQueue(null);

    expect(view.container.childElementCount).toBe(0);
  });

  it("renders an initial load failure without stale items", () => {
    renderQueue(new Error("source unavailable"));

    expect(screen.getByRole("heading", { name: "Project Queue" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Project queue error: source unavailable",
    );
  });

  it("shows the queued provider and model before dispatch", () => {
    renderQueue(null, [
      {
        id: "queue-1",
        projectId: "project-1" as ProjectQueueItemSummary["projectId"],
        target: {
          type: "new-session",
          provider: "codex",
          model: "gpt-5.6-sol",
        },
        messagePreview: "Queued work",
        message: { text: "Queued work" },
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
        status: "queued",
        attachmentCount: 0,
      },
    ]);

    expect(screen.getByRole("img", { name: "gpt-5.6-sol" })).toBeTruthy();
  });
});
