import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { compileTranscriptProjection } from "@yep-anywhere/shared/transcript/compiler";
import type { Message, SessionMetadata } from "../../../types";
import {
  createInitialSessionDetailState,
  reduceSessionDetailState,
} from "../transcriptReducer";

const session = {
  id: "session-1",
  projectId: "proj-1",
  provider: "codex",
} as SessionMetadata;
const snapshot = (text: string): Message => ({
  uuid: "commentary",
  id: "commentary",
  type: "assistant",
  _isStreaming: true,
  message: { role: "assistant", content: text },
});

describe("bulk transcript snapshots", () => {
  it.each(["loadPersistedTranscript", "replaceTailWindow"] as const)(
    "%s preserves distinct identities and collapses overlapping pagination",
    (type) => {
      const repeated = { ...snapshot("Same text"), _isStreaming: false };
      const messages = [
        snapshot("Same"),
        repeated,
        { ...repeated, id: "distinct", uuid: "distinct" },
      ];
      let state = reduceSessionDetailState(createInitialSessionDetailState(), {
        type,
        session,
        messages,
        codexStreamDurableIdAlignment: true,
      });
      expect(state.messages.map((message) => message.uuid)).toEqual([
        "commentary",
        "distinct",
      ]);
      state = reduceSessionDetailState(state, {
        type: "prependOlderMessages",
        messages,
        codexStreamDurableIdAlignment: true,
      });
      expect(state.messages.map((message) => message.uuid)).toEqual([
        "commentary",
        "distinct",
      ]);
      expect(compileTranscriptProjection(state.messages)).toHaveLength(2);
    },
  );

  it("renders one commentary row before and after durable catch-up without a remount", () => {
    let state = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      session,
      codexStreamDurableIdAlignment: true,
      messages: [
        snapshot("I’ll"),
        snapshot("I’ll open"),
        snapshot("I’ll open a Clair sketch."),
      ],
    });
    const rows = () =>
      compileTranscriptProjection(state.messages).map((item) => (
        <p key={item.id}>{item.type === "text" ? item.text : item.id}</p>
      ));
    const view = render(<div>{rows()}</div>);
    expect(view.container.querySelectorAll("p")).toHaveLength(1);
    expect(view.container.textContent).toBe("I’ll open a Clair sketch.");
    state = reduceSessionDetailState(state, {
      type: "applyCatchupMessages",
      codexStreamDurableIdAlignment: true,
      messages: [
        {
          uuid: "commentary",
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "I’ll open a Clair sketch." }],
          },
        },
      ],
    });
    view.rerender(<div>{rows()}</div>);
    expect(state.messages).toHaveLength(1);
    expect(view.container.querySelectorAll("p")).toHaveLength(1);
    state = reduceSessionDetailState(state, {
      type: "clearStreamingPlaceholders",
    });
    expect(state.messages).toHaveLength(1);
  });

  it("allows live updates to replace an unfinished REST fallback snapshot", () => {
    let state = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      session,
      messages: [snapshot("I’ll")],
      codexStreamDurableIdAlignment: true,
    });
    state = reduceSessionDetailState(state, {
      type: "applyStreamMessage",
      message: snapshot("I’ll open a Clair sketch."),
      codexStreamDurableIdAlignment: true,
    });
    expect(state.messages[0]?.message?.content).toBe(
      "I’ll open a Clair sketch.",
    );
  });
});
