import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SourceEditor } from "../SourceEditor";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  version: {} as Record<string, unknown>,
  share: null as object | null,
}));
const runtime = { sourceKey: "localhost", transport: { fetch: state.fetch } };
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
vi.mock("../../hooks/useVersion", () => ({
  useRetainedVersionInfo: () => state.version,
  useVersion: () => ({ version: state.version }),
}));
vi.mock("../../contexts/PublicShareContext", () => ({
  usePublicShareContext: () => state.share,
}));

const ORIGIN =
  window.location.hostname === "localhost"
    ? "http://artifacts.localhost:3400"
    : "https://artifacts.example.org";
const HTML = `<!doctype html><html><head><link rel="stylesheet" href="canvas.css"></head><body>
<!-- ya-source-target:v1 {"id":"intro","source":"sections/intro.qmd","sourceRange":[[0,0],[3,0]]} -->
<p>Intro</p>
<!-- /ya-source-target:v1 intro -->
</body></html>`;
const RUN_LABEL =
  "Load this page's stylesheets, images, and fonts (scripts stay off; click still selects a source item)";

function previewFrame() {
  return screen.getByTitle("Preview") as HTMLIFrameElement;
}

beforeEach(() => {
  state.version = {
    current: "0.8.2",
    capabilities: ["artifact-viewer", "file-source-editing"],
    artifactViewer: {
      port: 4402,
      available: true,
      locked: false,
      localOrigin: "http://artifacts.localhost:3400",
      publicOrigin: "https://artifacts.example.org",
    },
  };
  state.share = null;
  state.fetch.mockReset();
  state.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/file-edit"))
      return {
        path: "/proj/_build/paper.html",
        content: HTML,
        revision: "r1",
        editable: true,
      };
    if (path === "/artifacts" && init?.method === "POST")
      return {
        id: "grant",
        url: `${ORIGIN}/a/token/paper.html`,
        expiresAt: Date.now() + 1000,
      };
    throw new Error(`unexpected ${path}`);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ artifactViewer: 1 }),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <I18nProvider>
      <SourceEditor
        source={{ path: "_build/paper.html", projectId: "p1" }}
        artifact
        onClose={() => {}}
      />
    </I18nProvider>,
  );
}

it("starts as a bare snapshot and offers the styled-preview toggle", async () => {
  mount();
  await screen.findByRole("button", { name: RUN_LABEL });
  expect(previewFrame().getAttribute("srcdoc")).not.toContain("<base");
  expect(previewFrame().getAttribute("srcdoc")).not.toContain(ORIGIN);
  expect(state.fetch).toHaveBeenCalledTimes(1);
});

it("loads page assets from a granted artifact origin while keeping scripts off", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: RUN_LABEL }));
  await screen.findByRole("button", { name: "Stop loading page assets" });
  const srcdoc = previewFrame().getAttribute("srcdoc") ?? "";
  expect(srcdoc).toContain(`<base href="${ORIGIN}/a/token/paper.html">`);
  expect(srcdoc).toContain(`style-src 'unsafe-inline' ${ORIGIN}`);
  expect(srcdoc).toContain('<link rel="stylesheet" href="canvas.css">');
  expect(srcdoc).toContain("data-ya-edit-target");
  expect(previewFrame().getAttribute("sandbox")).toBe("allow-scripts");
  expect(screen.getByText(/Styled preview/)).toBeTruthy();
  const grantCall = state.fetch.mock.calls.find(
    ([path]) => path === "/artifacts",
  );
  expect(grantCall?.[1]?.method).toBe("POST");
  // The grant is requested for the canonical path the edit read resolved.
  expect(JSON.parse(grantCall?.[1]?.body as string)).toMatchObject({
    path: "/proj/_build/paper.html",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Stop loading page assets" }),
  );
  await waitFor(() =>
    expect(previewFrame().getAttribute("srcdoc")).not.toContain("<base"),
  );
});

it("does not offer the toggle for sources already on the artifact origin", async () => {
  render(
    <I18nProvider>
      <SourceEditor
        source={{ artifactUrl: `${ORIGIN}/a/other/index.html` }}
        artifact
        onClose={() => {}}
      />
    </I18nProvider>,
  );
  await screen.findByTitle("Preview");
  expect(screen.queryByRole("button", { name: RUN_LABEL })).toBeNull();
});
