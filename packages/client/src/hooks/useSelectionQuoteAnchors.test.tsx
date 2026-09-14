// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentAnchor } from "../lib/commentAnchors";
import type {
  ComposerDraftChange,
  ComposerDraftSignal,
} from "../lib/composerDraftSignal";
import { useSelectionQuoteAnchors } from "./useSelectionQuoteAnchors";
import { registerMarkdownCopySource } from "../lib/markdownSelectionCopy";

afterEach(() => {
  document.body.replaceChildren();
});

describe("useSelectionQuoteAnchors", () => {
  it.each([
    "src/example.ts",
    "~/agents/topics/example.md",
    "C:/other/example.ts",
  ])(
    "prefaces a selected file quote with its path and starting line: %s",
    (filePath) => {
      const container = document.createElement("div");
      const sourceElement = document.createElement("pre");
      const source = "unselected\nselected line\nnext line";
      sourceElement.textContent = source;
      container.append(sourceElement);
      document.body.append(container);
      const unregister = registerMarkdownCopySource(sourceElement, source, {
        projectId: "project-1",
        filePath,
        contentStartLine: 40,
      });
      const range = document.createRange();
      range.setStart(sourceElement.firstChild as Text, "unselected\n".length);
      range.setEnd(sourceElement.firstChild as Text, source.length);
      document.getSelection()?.addRange(range);
      const onQuoteSelection = vi.fn((text: string) => text);
      const { result } = renderHook(() =>
        useSelectionQuoteAnchors({
          containerRef: { current: container },
          onQuoteSelection,
          quoteClearSignal: 0,
        }),
      );

      act(() => {
        expect(result.current.applyQuoteFromSelection("c")).toBe(true);
      });
      expect(onQuoteSelection).toHaveBeenCalledWith(
        `re: ${filePath}:41\n> selected line\n> next line\nc`,
      );
      unregister();
    },
  );

  it("subscribes only while a quote anchor is live", () => {
    const sourceElement = document.createElement("div");
    const textNode = document.createTextNode("Selected text");
    sourceElement.append(textNode);
    document.body.append(sourceElement);
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const anchor: CommentAnchor = {
      id: "anchor-1",
      lineSignatures: ["Selected text"],
      quotedText: "> Selected text",
      range,
      selectedText: "Selected text",
      sourceElement,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const containerRef = { current: container };
    let draftListener: ((change: ComposerDraftChange) => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribeDraftChanges = vi.fn(
      (listener: (change: ComposerDraftChange) => void) => {
        draftListener = listener;
        return unsubscribe;
      },
    );
    const composerDraftSignal: ComposerDraftSignal = {
      getDraft: () => "",
      publishDraftChange: () => {},
      subscribeDraftChanges,
    };
    const onQuoteSelection = vi.fn((text: string) => text);
    const { result } = renderHook(() =>
      useSelectionQuoteAnchors({
        composerDraftSignal,
        containerRef,
        onQuoteSelection,
        quoteClearSignal: 0,
      }),
    );

    expect(subscribeDraftChanges).not.toHaveBeenCalled();
    act(() => {
      expect(result.current.applyQuoteAnchors([anchor])).toBe(true);
    });
    expect(onQuoteSelection).toHaveBeenCalledWith("> Selected text\n");
    expect(subscribeDraftChanges).toHaveBeenCalledTimes(1);

    act(() => {
      draftListener?.({
        hasTextContent: false,
        metadata: { mayAffectQuoteAnchors: false },
        text: "",
      });
    });
    expect(unsubscribe).not.toHaveBeenCalled();

    act(() => {
      draftListener?.({
        hasTextContent: false,
        metadata: { mayAffectQuoteAnchors: true },
        text: "",
      });
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
