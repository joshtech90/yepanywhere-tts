// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNonHumanUserTurnNavigation } from "../useNonHumanUserTurnNavigation";

const { markSessionSeen } = vi.hoisted(() => ({
  markSessionSeen: vi.fn(),
}));

vi.mock("../../api/client", () => ({ api: { markSessionSeen } }));

vi.mock("../useVersion", async () => {
  const { NON_HUMAN_USER_TURN_CAPABILITY } = await import(
    "@yep-anywhere/shared"
  );
  return {
    useVersion: () => ({
      version: { capabilities: [NON_HUMAN_USER_TURN_CAPABILITY] },
    }),
  };
});

function Harness({
  onError,
}: {
  onError: (kind: "unavailable" | "acknowledgement") => void;
}) {
  useNonHumanUserTurnNavigation({
    sessionId: "receiver",
    messages: [{ uuid: "turn-1" }],
    loading: false,
    loadingOlder: false,
    hasOlder: false,
    loadOlder: async () => {},
    jump: (_target, onResolved) => onResolved(true),
    onError,
  });
  return null;
}

function renderNavigation(
  onError: (kind: "unavailable" | "acknowledgement") => void,
) {
  render(
    <MemoryRouter initialEntries={["/?nonHumanTurn=turn-1"]}>
      <Harness onError={onError} />
    </MemoryRouter>,
  );
}

describe("useNonHumanUserTurnNavigation", () => {
  beforeEach(() => {
    markSessionSeen.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("reports an acknowledgement the server refused", async () => {
    markSessionSeen.mockResolvedValue({ marked: true, acknowledged: false });
    const onError = vi.fn();

    renderNavigation(onError);

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("acknowledgement"),
    );
  });

  it("stays quiet when the visited turn is acknowledged", async () => {
    markSessionSeen.mockResolvedValue({ marked: true, acknowledged: true });
    const onError = vi.fn();

    renderNavigation(onError);

    await waitFor(() =>
      expect(markSessionSeen).toHaveBeenCalledWith(
        "receiver",
        undefined,
        "turn-1",
        "turn-1",
      ),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("stays quiet when an older server answers without the field", async () => {
    markSessionSeen.mockResolvedValue({ marked: true });
    const onError = vi.fn();

    renderNavigation(onError);

    await waitFor(() => expect(markSessionSeen).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
  });
});
