import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ArtifactPreview } from "../ArtifactPreview";

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
}));
vi.mock("../../contexts/PublicShareContext", () => ({
  usePublicShareContext: () => state.share,
}));

beforeEach(() => {
  state.version = {
    current: "0.8.2",
    capabilities: ["artifact-viewer"],
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <I18nProvider>
      <ArtifactPreview
        html="<p>Static</p>"
        path="/mockup/index.html"
        title="Mockup"
      />
    </I18nProvider>,
  );
}

it("does not contact an artifact origin or request grants from an old server", () => {
  state.version = { current: "0.8.1" };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mount();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByTitle("Mockup").getAttribute("sandbox")).toBe("");
  expect(fetch).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("keeps a static preview when resolution fails and retries only on request", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetch);
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Run interactive preview" }),
  );
  await screen.findByRole("status");
  expect(state.fetch).not.toHaveBeenCalled();
  expect(screen.getByTitle("Mockup").getAttribute("sandbox")).toBe("");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/health"),
    expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry interactive preview" }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

it("admits only after a successful probe and revokes on close", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ artifactViewer: 1 }),
    }),
  );
  const origin =
    window.location.hostname === "localhost"
      ? "http://artifacts.localhost:3400"
      : "https://artifacts.example.org";
  state.fetch.mockResolvedValue({
    id: "grant",
    url: `${origin}/a/token/index.html`,
    expiresAt: Date.now() + 1000,
  });
  const { unmount } = mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Run interactive preview" }),
  );
  await screen.findByRole("button", { name: "Stop interactive preview" });
  expect(screen.getByTitle("Mockup").getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin",
  );
  expect(screen.getByTitle("Mockup").getAttribute("src")).toBe(
    `${origin}/a/token/index.html`,
  );
  unmount();
  expect(state.fetch).toHaveBeenLastCalledWith("/artifacts/grant", {
    method: "DELETE",
  });
});

it("never offers private grants in a public share", () => {
  state.share = {};
  mount();
  expect(screen.queryByRole("button")).toBeNull();
  expect(state.fetch).not.toHaveBeenCalled();
});
