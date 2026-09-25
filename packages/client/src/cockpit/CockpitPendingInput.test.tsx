import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import type { InputRequest } from "../types";
import { CockpitPendingInput } from "./CockpitPendingInput";

function approvalRequest(
  overrides: Partial<InputRequest> = {},
): InputRequest {
  return {
    id: "request-1",
    sessionId: "session-1",
    type: "tool-approval",
    prompt: "Allow the fictional tool?",
    toolName: "UnfamiliarTool",
    toolInput: { task: "Check the fictional preview." },
    timestamp: "2026-09-25T01:00:00.000Z",
    ...overrides,
  };
}

function renderInput({
  onNotice = vi.fn(),
  onRefresh = vi.fn(async () => null),
  onRespond = vi.fn(async () => {}),
  reconnecting = false,
  request = approvalRequest(),
}: {
  onNotice?: (notice: "accepted" | "stale") => void;
  onRefresh?: () => Promise<InputRequest | null>;
  onRespond?: (
    requestId: string,
    response: "approve" | "approve_accept_edits" | "deny",
    answers?: Record<string, string | string[]>,
    feedback?: string,
  ) => Promise<void>;
  reconnecting?: boolean;
  request?: InputRequest;
} = {}) {
  return render(
    <I18nProvider>
      <CockpitPendingInput
        onNotice={onNotice}
        onRefresh={onRefresh}
        onRespond={onRespond}
        reconnecting={reconnecting}
        request={request}
        sessionId="session-1"
      />
    </I18nProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(UI_KEYS.locale, "en");
  vi.restoreAllMocks();
});

describe("Cockpit pending input", () => {
  it("sends one response for rapid approval clicks and reports server acceptance", async () => {
    let resolveResponse: (() => void) | undefined;
    const onRespond = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const onNotice = vi.fn();
    renderInput({ onNotice, onRespond });
    const approve = screen.getByRole("button", { name: /Yes/ });
    await waitFor(() => expect(approve.hasAttribute("disabled")).toBe(false));

    fireEvent.click(approve);
    fireEvent.click(approve);

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(
      "request-1",
      "approve",
      undefined,
      undefined,
    );
    expect(screen.getByRole("status").textContent).toBe("Sending response...");

    await act(async () => {
      resolveResponse?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("accepted"));
  });

  it("keeps a failed approval available for retry with a visible error", async () => {
    const onRespond = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("preview server unavailable"))
      .mockResolvedValueOnce(undefined);
    renderInput({ onRespond });
    const approve = screen.getByRole("button", { name: /Yes/ });
    await waitFor(() => expect(approve.hasAttribute("disabled")).toBe(false));

    fireEvent.click(approve);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "preview server unavailable",
    );
    await waitFor(() => expect(approve.hasAttribute("disabled")).toBe(false));
    fireEvent.click(approve);

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(2));
  });

  it("reconciles an already answered request and marks it stale", async () => {
    const stale = Object.assign(new Error("No pending input request"), {
      status: 400,
    });
    const onRespond = vi.fn(async () => {
      throw stale;
    });
    const onRefresh = vi.fn(async () => null);
    const onNotice = vi.fn();
    renderInput({ onNotice, onRefresh, onRespond });
    const deny = screen.getByRole("button", { name: /No/ });
    await waitFor(() => expect(deny.hasAttribute("disabled")).toBe(false));

    fireEvent.click(deny);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(onNotice).toHaveBeenCalledWith("stale");
    expect(screen.getByRole("alert").textContent).toContain(
      "already answered",
    );
  });

  it("adapts a provider-neutral choice into the existing question panel", async () => {
    const onRespond = vi.fn(async () => {});
    renderInput({
      onRespond,
      reconnecting: true,
      request: approvalRequest({
        type: "choice",
        prompt: "Choose a fictional review mode.",
        options: ["Concise", "Detailed"],
        toolName: undefined,
        toolInput: undefined,
      }),
    });

    expect(screen.getByText(/Connection is recovering/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Concise/ }));
    const submit = screen.getByRole("button", { name: /Submit/ });
    await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith(
        "request-1",
        "approve",
        { "request-1": "Concise" },
        undefined,
      ),
    );
  });
});
