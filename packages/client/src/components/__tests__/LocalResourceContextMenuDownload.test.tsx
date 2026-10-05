import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useLocalResourceClick } from "../LocalMediaModal";

const fetchBlob = vi.fn();
const runtime = {
  sourceKey: "localhost",
  transport: {
    fetch: vi.fn(),
    fetchBlob,
    capabilities: { sameOriginUrls: true },
  },
};
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
vi.mock("../../hooks/useVersion", () => ({
  useRetainedVersionInfo: () => ({}),
  useVersion: () => ({ version: {} }),
}));
vi.mock("../../hooks/usePublicShareStatus", () => ({
  usePublicShareStatus: () => ({ status: null }),
}));
vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

const PROJECT_ID = "cHJvamVjdA";

function Harness({ href, text }: { href: string; text: string }) {
  const { handleContextMenu, contextMenuElement } = useLocalResourceClick();
  return (
    <div role="group" onContextMenu={handleContextMenu}>
      <a href={href}>{text}</a>
      {contextMenuElement}
    </div>
  );
}

function downloadFromMenu(href: string, text: string): HTMLAnchorElement[] {
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
  render(
    <I18nProvider>
      <Harness href={href} text={text} />
    </I18nProvider>,
  );
  fireEvent.contextMenu(screen.getByText(text));
  fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
  return clicked;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fetchBlob.mockReset();
});

it("hands a direct project-file download to the browser", () => {
  const clicked = downloadFromMenu(
    `http://localhost:3400/projects/${PROJECT_ID}/file?path=dist%2Fsoftware.tgz`,
    "dist/software.tgz",
  );
  expect(clicked).toHaveLength(1);
  expect(clicked[0]?.getAttribute("href")).toBe(
    `/api/projects/${PROJECT_ID}/files/raw?path=dist%2Fsoftware.tgz&download=true`,
  );
  expect(clicked[0]?.download).toBe("software.tgz");
  expect(fetchBlob).not.toHaveBeenCalled();
});

it("hands a direct host-file download to the browser", () => {
  const clicked = downloadFromMenu(
    "/api/local-file?path=%2Fdata%2Fsoftware.tgz",
    "/data/software.tgz",
  );
  expect(clicked).toHaveLength(1);
  expect(clicked[0]?.getAttribute("href")).toBe(
    "/api/local-file?path=%2Fdata%2Fsoftware.tgz&download=true",
  );
  expect(clicked[0]?.download).toBe("software.tgz");
  expect(fetchBlob).not.toHaveBeenCalled();
});

it("downloads direct host media through the media route", () => {
  const clicked = downloadFromMenu(
    "/api/local-image?path=%2Fdata%2Fclip.mp4",
    "/data/clip.mp4",
  );
  expect(clicked).toHaveLength(1);
  expect(clicked[0]?.getAttribute("href")).toBe(
    "/api/local-image?path=%2Fdata%2Fclip.mp4",
  );
  expect(clicked[0]?.download).toBe("clip.mp4");
  expect(fetchBlob).not.toHaveBeenCalled();
});
