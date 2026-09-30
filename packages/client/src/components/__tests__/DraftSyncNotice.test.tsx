import {
  act,
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingDraft } from "../../lib/draftSyncStorage";
import { DRAFT_SYNC_STATUS_EVENT } from "../../lib/draftSyncStorage";
import { I18nProvider } from "../../i18n";
import type { ReactNode } from "react";
import { DraftSyncNotice } from "../DraftSyncNotice";

function render(node: ReactNode) {
  return renderComponent(node, { wrapper: I18nProvider });
}

const state = vi.hoisted(() => ({
  drafts: [] as PendingDraft[],
  resolve: vi.fn(),
  discard: vi.fn(),
  retry: vi.fn(),
  recover: vi.fn(),
}));
vi.mock("../../lib/draftSyncStorage", async (original) => ({
  ...(await original<typeof import("../../lib/draftSyncStorage")>()),
  draftSyncPending: () => state.drafts,
  resolvePendingDraft: state.resolve,
  discardPendingDraft: state.discard,
  retryPendingDraft: state.retry,
  acceptPendingDraft: state.recover,
}));
function pending(sessionId: string): PendingDraft {
  return {
    key: `draft-message-${sessionId}`,
    slot: { kind: "session", sessionId },
    recovery: false,
    local: { fields: { text: `local ${sessionId}` }, attachments: [] },
    remote: {
      slot: { kind: "session", sessionId },
      revision: "revision-1",
      sequence: 1,
      updatedAt: 1,
      payload: { fields: { text: `remote ${sessionId}` }, attachments: [] },
    },
  };
}
beforeEach(() => {
  state.drafts = [pending("one"), pending("two")];
  vi.clearAllMocks();
  state.resolve.mockResolvedValue(true);
});
describe("DraftSyncNotice", () => {
  it("only exposes the current session and hides preview until review", () => {
    const { rerender } = render(
      <DraftSyncNotice draftKey="draft-message-one" sessionId="one" />,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText("local one")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    expect(screen.getByText("local one")).toBeTruthy();
    expect(screen.getByText("remote one")).toBeTruthy();
    expect(screen.queryByText("local two")).toBeNull();
    rerender(
      <DraftSyncNotice
        draftKey="draft-message-unrelated"
        sessionId="unrelated"
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
  it.each([
    ["Keep mine", "local"],
    ["Use other version", "remote"],
    ["Combine drafts", "combine"],
  ])("applies %s to this draft only", async (label, choice) => {
    render(<DraftSyncNotice draftKey="draft-message-one" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(state.resolve).toHaveBeenCalledWith(
        "draft-message-one",
        choice,
        "revision-1",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: label }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(state.resolve).toHaveBeenCalledTimes(1);
  });
  it("leaves the review open when refreshed evidence requires another choice", async () => {
    state.resolve.mockResolvedValue(false);
    render(<DraftSyncNotice draftKey="draft-message-one" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use other version" }));
    await screen.findByText(
      "Your choice was not applied. Review the latest versions and try again.",
    );
    expect(screen.getByText("local one")).toBeTruthy();
    act(() => {
      state.drafts = [];
      window.dispatchEvent(new Event(DRAFT_SYNC_STATUS_EVENT));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("closing a review preserves drafts; discard explicitly targets one", () => {
    state.drafts[0]!.error = "sync";
    render(<DraftSyncNotice draftKey="draft-message-one" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close review" }));
    expect(state.discard).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.retry).toHaveBeenCalledWith("draft-message-one");
    expect(state.recover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(state.discard).toHaveBeenCalledWith("draft-message-one");
    expect(state.discard).toHaveBeenCalledTimes(1);
  });
});
