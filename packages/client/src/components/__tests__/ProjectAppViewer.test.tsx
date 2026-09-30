import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ProjectAppViewer } from "../ProjectAppViewer";

const mock = vi.hoisted(() => ({
  version: "0.9.4",
  denyLivePreview: false,
  fetch: vi.fn(),
}));
vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => ({
    version: {
      current: mock.version,
      deniedCapabilityBits: mock.denyLivePreview ? [[3, 64]] : [],
    },
  }),
}));
vi.mock("../../api/sourceApiFetch", () => ({ fetchJSON: mock.fetch }));
beforeEach(() => {
  mock.version = "0.9.4";
  mock.denyLivePreview = false;
  mock.fetch.mockReset().mockImplementation(async (path: string) =>
    path.endsWith("/open")
      ? {
          id: "static:test",
          kind: "static",
          label: "Canvas",
          url: "https://artifacts.example/a/token/index.html",
          transferable: true,
        }
      : path.endsWith("/address")
        ? { enabled: false, reservations: [] }
        : {
            projectId: "test",
            declaration: { where: { kind: "static" } },
            state: "ready",
            latestArtifact: null,
            canExecute: true,
            canShare: true,
            removedFrom: [],
          },
  );
});
afterEach(cleanup);
it.each([false, true])(
  "gates live preview start requests when denied=%s",
  async (denied) => {
    mock.denyLivePreview = denied;
    const original = mock.fetch.getMockImplementation()!;
    mock.fetch.mockImplementation(async (...args) => {
      const value = await original(...args);
      if (String(args[0]).endsWith("/app"))
        return { ...value, livePreview: { where: { kind: "process" } } };
      return value;
    });
    render(
      <I18nProvider>
        <ProjectAppViewer projectId="test" presentation="settings" />
      </I18nProvider>,
    );
    await screen.findByText("App: ready");
    if (denied) {
      expect(screen.queryByRole("button", { name: "Live preview" })).toBeNull();
      expect(
        mock.fetch.mock.calls.some(([path]) => path.endsWith("/start")),
      ).toBe(false);
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Live preview" }));
      await waitFor(() =>
        expect(mock.fetch).toHaveBeenCalledWith("/projects/test/app/start", {
          method: "POST",
          body: JSON.stringify({ mode: "live-preview" }),
        }),
      );
    }
  },
);
it("renders address controls inline and saves visibility without stopping serving", async () => {
  const row = {
    name: "canvas",
    namespace: "apps.example",
    owner: "superuser",
    serving: true,
    public: false,
    privateOnly: false,
    url: "https://canvas.apps.example/?ya_access=private",
  };
  mock.fetch.mockImplementation(
    async (path: string, options?: { body: string }) => {
      if (path.endsWith("/serve")) {
        Object.assign(row, JSON.parse(options!.body));
        return row;
      }
      if (path.endsWith("/address"))
        return {
          enabled: true,
          namespace: "apps.example",
          canPublish: true,
          reservations: [{ ...row }],
        };
      return { state: "ready", declaration: null, removedFrom: [] };
    },
  );
  const { container } = render(
    <I18nProvider>
      <ProjectAppViewer projectId="test" presentation="settings" />
    </I18nProvider>,
  );
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Public — no link required" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save access" }));
  await waitFor(() => expect(row.public).toBe(true));
  expect(row.serving).toBe(true);
  expect(container.querySelector("iframe")).toBeNull();
  expect(mock.fetch.mock.calls.some(([path]) => path.endsWith("/open"))).toBe(
    false,
  );
  expect(
    screen
      .getByRole("button", { name: "Copy viewer link" })
      .getAttribute("href"),
  ).toBe(row.url);
});
it("tells a user without publishing permission who can make the app public", async () => {
  mock.fetch.mockImplementation(async (path: string) => {
    if (path.endsWith("/address"))
      return {
        enabled: true,
        namespace: "apps.example",
        canPublish: false,
        reservations: [
          {
            name: "archer-canvas",
            namespace: "apps.example",
            owner: "archer",
            serving: true,
            public: false,
            privateOnly: true,
          },
        ],
      };
    return { state: "ready", declaration: null, removedFrom: [] };
  });
  render(
    <I18nProvider>
      <ProjectAppViewer projectId="test" presentation="settings" />
    </I18nProvider>,
  );
  expect(
    await screen.findByText(
      /Public access \(no link required\) needs the administrator/,
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole("checkbox", { name: "Public — no link required" }),
  ).toBeNull();
});
it("sends no App requests to an older server", () => {
  mock.version = "0.9.2";
  render(
    <I18nProvider>
      <ProjectAppViewer projectId="test" onBack={() => {}} />
    </I18nProvider>,
  );
  expect(screen.getByText("Project App requires a newer server.")).toBeTruthy();
  expect(mock.fetch).not.toHaveBeenCalled();
});
it("offers a view-only user Start for a stopped app and never Stop", async () => {
  const process = {
    version: 1,
    where: { kind: "process", cwd: ".", entry: "/" },
    start: { argv: ["npm", "start"], portEnv: "PORT" },
  };
  let running = false;
  mock.fetch.mockImplementation(async (path: string) =>
    path.endsWith("/address")
      ? { enabled: false, reservations: [] }
      : path.endsWith("/app")
        ? {
            projectId: "test",
            declaration: process,
            ...(running ? { activeDeclaration: process } : {}),
            state: running ? "running" : "stopped",
            latestArtifact: null,
            canExecute: false,
            canStart: true,
            canShare: false,
            removedFrom: [],
          }
        : new Promise(() => {}),
  );
  render(
    <I18nProvider>
      <ProjectAppViewer projectId="test" onBack={() => {}} />
    </I18nProvider>,
  );
  expect(await screen.findByRole("button", { name: "Start app" })).toBeTruthy();
  running = true;
  cleanup();
  render(
    <I18nProvider>
      <ProjectAppViewer projectId="test" onBack={() => {}} />
    </I18nProvider>,
  );
  await screen.findByText(/running/);
  expect(screen.queryByRole("button", { name: "Stop app" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start app" })).toBeNull();
});
it("keeps the live iframe across settings and sharing and delegates mic synchronously to its composer", async () => {
  const toggle = vi.fn();
  const onVoice = vi.fn();
  const { container } = render(
    <I18nProvider>
      <ProjectAppViewer
        projectId="test"
        onBack={() => {}}
        onVoice={onVoice}
        voice={{
          toggle,
          isListening: false,
          isAvailable: true,
          stopAndFinalize: () => "",
          cancelProcessing: vi.fn(),
          prewarm: vi.fn(),
          beginInsertionBoundary: vi.fn(),
          continueAfterSpeechSend: vi.fn(),
        }}
      />
    </I18nProvider>,
  );
  await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
  const frame = container.querySelector("iframe");
  fireEvent.click(screen.getByRole("button", { name: "Start microphone" }));
  expect(onVoice).toHaveBeenCalledTimes(1);
  expect(toggle).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "App settings" }));
  await waitFor(() =>
    expect(mock.fetch).toHaveBeenCalledWith("/projects/test/app/address"),
  );
  expect(container.querySelector("iframe")).toBe(frame);
  expect(screen.queryByRole("group", { name: "App address" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Share app" }));
  fireEvent.click(screen.getByRole("button", { name: "Create share link" }));
  await screen.findByText("Valid while this app launch is running.");
  expect(container.querySelector("iframe")).toBe(frame);
});
