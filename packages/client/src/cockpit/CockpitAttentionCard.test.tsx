import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { InputRequest } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitAttentionCard } from "./CockpitAttentionCard";
import type {
  CockpitAttentionActionResult,
  CockpitAttentionPort,
} from "./useCockpitAttention";

function questionRequest(): InputRequest {
  return {
    id: "request-1",
    sessionId: "session-1",
    type: "question",
    prompt: "Choose the validation scope.",
    toolName: "AskUserQuestion",
    toolInput: {
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "What should be checked?",
          isOther: false,
          options: [
            { label: "Unit tests", description: "Run the focused suite" },
            { label: "Full gate", description: "Run every required check" },
          ],
        },
      ],
    },
    timestamp: "2026-09-24T10:00:00.000Z",
  };
}

function renderCard(
  respond: CockpitAttentionPort["respond"] = vi.fn(
    () => Promise.resolve({ kind: "accepted" as const }),
  ),
) {
  return {
    respond,
    ...render(
      <I18nProvider>
        <CockpitAttentionCard request={questionRequest()} respond={respond} />
      </I18nProvider>,
    ),
  };
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(UI_KEYS.locale, "en");
});

describe("Cockpit attention card", () => {
  it("answers a structured question through the server-authoritative action", async () => {
    const { respond } = renderCard();

    expect(
      (screen.getByRole("button", {
        name: "Send answer",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Full gate/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    await waitFor(() => {
      expect(respond).toHaveBeenCalledWith("request-1", "approve", {
        scope: "Full gate",
      });
    });
    expect(
      await screen.findByText("The server confirmed your response."),
    ).toBeTruthy();
  });

  it("guards repeated approval clicks while the first response is pending", async () => {
    let release = () => {};
    const respond = vi.fn(
      () =>
        new Promise<{ kind: "accepted" }>((resolve) => {
          release = () => resolve({ kind: "accepted" });
        }),
    );
    const approval: InputRequest = {
      id: "approval-1",
      sessionId: "session-1",
      type: "tool-approval",
      prompt: "Allow the invented formatting command?",
      toolName: "Bash",
      toolInput: { command: "printf demo" },
      timestamp: "2026-09-24T10:00:00.000Z",
    };

    render(
      <I18nProvider>
        <CockpitAttentionCard request={approval} respond={respond} />
      </I18nProvider>,
    );
    const approve = screen.getByRole("button", { name: "Approve" });
    fireEvent.click(approve);
    fireEvent.click(approve);

    expect(respond).toHaveBeenCalledTimes(1);
    release();
    await screen.findByText("The server confirmed your response.");
  });

  it("marks an already answered request as stale instead of claiming success", async () => {
    renderCard(
      vi.fn(() => Promise.resolve({ kind: "stale" as const })),
    );

    fireEvent.click(screen.getByRole("button", { name: /Unit tests/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(
      await screen.findByText("This request was already answered or replaced."),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "Send answer",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps an answer available for retry after a server failure", async () => {
    let attempt = 0;
    const respond: CockpitAttentionPort["respond"] = vi.fn(
      (): Promise<CockpitAttentionActionResult> => {
        attempt += 1;
        const result: CockpitAttentionActionResult = attempt === 1
          ? { kind: "error", message: "temporary demo failure" }
          : { kind: "accepted" };
        return Promise.resolve(result);
      },
    );
    renderCard(respond);

    fireEvent.click(screen.getByRole("button", { name: /Unit tests/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(
      await screen.findByText(
        "The response failed: temporary demo failure",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(
      await screen.findByText("The server confirmed your response."),
    ).toBeTruthy();
    expect(respond).toHaveBeenCalledTimes(2);
  });
});
