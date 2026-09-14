// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setInlineMediaExpandedPreference } from "../../../hooks/useInlineMedia";
import { I18nProvider } from "../../../i18n";
import { asClientSummarySourceKey } from "../../../lib/clientSummaryStore";
import type { ExplorationParent } from "../../../lib/sessionDetail/explorationProjection";
import type { YaSourceRuntime } from "../../../lib/sourceRuntime";
import { SourceRuntimeProvider } from "../../../lib/sourceRuntimeReact";
import { FakeSourceTransport } from "../../../lib/transport";
import {
  collectExploredImages,
  ExploredImageStrip,
} from "../ExploredImageStrip";

function imageParent(id: string, path: string): ExplorationParent {
  return {
    item: {
      type: "tool_call",
      id,
      sourceMessages: [],
      toolName: "Read",
      toolInput: { file_path: path },
      status: "complete",
      toolResult: {
        content: "",
        isError: false,
        structured: {
          type: "image",
          file: { type: "image/png", originalSize: 5152 },
        },
      },
    },
    entries: [],
  };
}

function textParent(id: string, path: string): ExplorationParent {
  return {
    item: {
      type: "tool_call",
      id,
      sourceMessages: [],
      toolName: "Read",
      toolInput: { file_path: path },
      status: "complete",
      toolResult: {
        content: "",
        isError: false,
        structured: {
          type: "text",
          file: { filePath: path, content: "hi", numLines: 1 },
        },
      },
    },
    entries: [],
  };
}

function createRuntime(transport: FakeSourceTransport): YaSourceRuntime {
  return {
    sourceKey: asClientSummarySourceKey("test:explored-image-strip"),
    transport,
    api: {} as YaSourceRuntime["api"],
    summary: {} as YaSourceRuntime["summary"],
    sessionDetails: {} as YaSourceRuntime["sessionDetails"],
  };
}

function renderWithRuntime(children: ReactNode, runtime: YaSourceRuntime) {
  return render(
    <I18nProvider>
      <SourceRuntimeProvider runtime={runtime}>
        {children}
      </SourceRuntimeProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  setInlineMediaExpandedPreference(false);
});

describe("collectExploredImages", () => {
  it("keeps image reads and drops text reads", () => {
    expect(
      collectExploredImages([
        imageParent("a", "/tmp/phone.png"),
        textParent("b", "/tmp/notes.md"),
        imageParent("c", "/tmp/desktop.png"),
      ]).map((image) => image.name),
    ).toEqual(["phone.png", "desktop.png"]);
  });

  it("shows one entry per path when the same file is read twice", () => {
    expect(
      collectExploredImages([
        imageParent("a", "/tmp/phone.png"),
        imageParent("b", "/tmp/phone.png"),
      ]),
    ).toHaveLength(1);
  });
});

describe("ExploredImageStrip", () => {
  it("fetches thumbnails by path only once expanded", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:explored-image"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const fetchBlob = vi.fn(
      async () => new Blob(["png"], { type: "image/png" }),
    );
    const runtime = createRuntime(
      new FakeSourceTransport({
        kind: "secure",
        capabilities: { sameOriginUrls: false },
        fetchBlob,
      }),
    );

    renderWithRuntime(
      <ExploredImageStrip
        images={collectExploredImages([imageParent("a", "/tmp/phone.png")])}
      />,
      runtime,
    );

    expect(fetchBlob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "1 image" }));

    await waitFor(() => {
      expect(fetchBlob).toHaveBeenCalledWith(
        "/local-image?path=%2Ftmp%2Fphone.png",
      );
    });
    const thumbnail = await screen.findByRole("img", { name: "phone.png" });
    expect(thumbnail.getAttribute("src")).toBe("blob:explored-image");
  });
});
