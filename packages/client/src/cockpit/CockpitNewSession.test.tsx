import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitNewSession } from "./CockpitNewSession";
import { COCKPIT_APP_SHARE_EVENT } from "./useCockpitAppShare";

const state = vi.hoisted(() => ({
  voiceBackends: [] as string[],
  transcribe: vi.fn(),
  projects: [] as Array<{ id: string; name: string; path: string }>,
  providers: [] as unknown[],
  loaded: true,
  serverFavorites: [] as Array<{ path: string; label: string }>,
  updateSetting: vi.fn(async () => {}),
  calls: [] as string[],
  createResponse: {} as Record<string, unknown>,
  fetch: vi.fn(),
  startSession: vi.fn(),
  otherHost: false,
  otherFetch: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    getServerSettings: vi.fn(async () => ({
      settings: { cockpitProjectFavorites: state.serverFavorites },
    })),
    startSession: state.startSession,
    addProject: (path: string) =>
      state.fetch("/projects", {
        method: "POST",
        body: JSON.stringify({ path }),
      }),
  },
}));

vi.mock("../lib/sourceRuntime", () => ({
  getSourceRuntimeRegistry: () => ({
    getCurrentSourceRuntime: () => ({
      transport: {
        fetch: state.otherHost ? state.otherFetch : state.fetch,
        upload: state.upload,
        uploadStagedAttachment: vi.fn(),
      },
    }),
  }),
}));

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({
    sourceKey: "local",
    transport: {
      fetch: state.fetch,
      upload: state.upload,
      uploadStagedAttachment: vi.fn(),
    },
  }),
}));

vi.mock("../hooks/useVersion", () => ({
  useVersion: () => ({ version: { voiceBackends: state.voiceBackends } }),
}));

vi.mock("../lib/speechProviders/YaServerProvider", () => ({
  transcribeSpeechAudio: state.transcribe,
}));

vi.mock("../hooks/useProjects", () => ({
  useProjects: () => ({ projects: state.projects }),
}));

vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({ providers: state.providers, loading: false }),
}));

vi.mock("../hooks/useModelSettings", () => ({
  useModelSettings: () => ({ thinkingMode: "off", effortLevel: "medium" }),
}));

vi.mock("../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: state.loaded
      ? {
          cockpitProjectFavorites: [
            { path: "/work/os", label: "SZ OS" },
            { path: "/work/fresh", label: "Fresh" },
          ],
        }
      : null,
    updateSetting: state.updateSetting,
  }),
}));

afterEach(() => {
  cleanup();
  delete window.__yepAppShare;
  vi.unstubAllGlobals();
});
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
  state.voiceBackends = [];
  state.transcribe.mockReset();
  state.projects = [];
  state.loaded = true;
  state.serverFavorites = [
    { path: "/work/os", label: "SZ OS" },
    { path: "/work/fresh", label: "Fresh" },
    { path: "/work/phone", label: "Added on the phone" },
  ];
  state.updateSetting.mockClear();
  state.providers = [];
  state.calls = [];
  state.createResponse = {
    sessionId: "s1",
    processId: "p1",
    projectId: "os",
    permissionMode: "default",
    modeVersion: 1,
    serverTimestamp: 1,
  };
  state.fetch
    .mockReset()
    .mockImplementation(async (path: string, init?: RequestInit) => {
      state.calls.push(`${init?.method ?? "GET"} ${path}`);
      return path.endsWith("/sessions/create") || path.endsWith("/sessions")
        ? state.createResponse
        : { queued: true };
    });
  state.upload.mockReset().mockImplementation(async (...args: unknown[]) => {
    state.calls.push(`upload:${(args[2] as File).name}`);
    return {
      id: "f1",
      originalName: (args[2] as File).name,
      name: "f1-notes.txt",
      path: "/uploads/s1/f1-notes.txt",
      size: 5,
      mimeType: "text/plain",
    };
  });
  state.otherHost = false;
  state.otherFetch.mockReset().mockResolvedValue(state.createResponse);
  state.startSession
    .mockReset()
    .mockImplementation(
      (projectId: string, message: string, options: unknown) =>
        (state.otherHost ? state.otherFetch : state.fetch)(
          `/projects/${projectId}/sessions`,
          {
            method: "POST",
            body: JSON.stringify({ message, ...(options as object) }),
          },
        ),
    );
});

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <CockpitNewSession basePath="" />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("Cockpit new session dictation", () => {
  class FakeRecorder {
    static isTypeSupported = () => true;
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm;codecs=opus";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["voice"]) });
      this.onstop?.();
    }
  }

  function enableDictation(
    getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }],
    })) as () => Promise<unknown>,
  ) {
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    state.voiceBackends = ["ya-groq"];
  }

  function messageField() {
    return screen.getByRole("textbox", {
      name: "First message",
    }) as HTMLTextAreaElement;
  }

  async function record() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dictate (Groq)" }));
    });
  }

  async function stopRecording() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop dictation" }));
    });
  }

  it("offers no mic when the server has no Groq backend", () => {
    state.voiceBackends = [];
    renderPage();
    expect(screen.queryByRole("button", { name: "Dictate (Groq)" })).toBeNull();
  });

  it("dictates the first message at the end of what was typed", async () => {
    enableDictation();
    state.transcribe.mockResolvedValue({ text: "hello from the phone" });
    renderPage();
    const message = messageField();
    fireEvent.change(message, { target: { value: "Note:" } });

    await record();
    await stopRecording();

    await vi.waitFor(() =>
      expect(message.value).toBe("Note: hello from the phone"),
    );
  });

  it("holds the start until the recording has become text", async () => {
    enableDictation();
    state.projects = [{ id: "os", name: "Smartzone OS", path: "/work/os" }];
    state.providers = [claudeProvider];
    let answer: (value: { text: string }) => void = () => {};
    state.transcribe.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderPage();
    const message = messageField();
    fireEvent.change(message, { target: { value: "Note:" } });
    const start = screen.getByRole("button", {
      name: "Start session",
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);

    await record();
    expect(start.disabled).toBe(true);
    await stopRecording();
    expect(start.disabled).toBe(true);

    await act(async () => {
      answer({ text: "the rest" });
    });
    expect(message.value).toBe("Note: the rest");
    expect(start.disabled).toBe(false);
  });

  it("keeps a share that lands in the same render as the transcript", async () => {
    enableDictation();
    let answer: (value: { text: string }) => void = () => {};
    state.transcribe.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderPage();
    const message = messageField();
    fireEvent.change(message, { target: { value: "Base" } });
    await record();
    await stopRecording();

    await act(async () => {
      window.__yepAppShare = [{ text: "Shared" }];
      window.dispatchEvent(new Event(COCKPIT_APP_SHARE_EVENT));
      answer({ text: "spoken" });
    });

    expect(message.value).toContain("Shared");
    expect(message.value).toContain("spoken");
    expect(message.value).toContain("Base");
  });

  it("leaves the caret after text dictated into the middle", async () => {
    enableDictation();
    state.transcribe.mockResolvedValue({ text: "middle" });
    renderPage();
    const message = messageField();
    fireEvent.change(message, { target: { value: "before after" } });
    message.setSelectionRange(6, 6);
    fireEvent.select(message);

    await record();
    await stopRecording();

    await vi.waitFor(() => expect(message.value).toBe("before middle after"));
    expect(message.selectionStart).toBe("before middle".length);
    expect(message.selectionEnd).toBe("before middle".length);
  });

  it("moves the caret on a phone without opening the keyboard", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("coarse"),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    enableDictation();
    state.transcribe.mockResolvedValue({ text: "middle" });
    renderPage();
    const message = messageField();
    fireEvent.change(message, { target: { value: "before after" } });
    message.setSelectionRange(6, 6);
    fireEvent.select(message);
    message.blur();

    await record();
    await stopRecording();

    await vi.waitFor(() => expect(message.value).toBe("before middle after"));
    expect(message.selectionStart).toBe("before middle".length);
    expect(document.activeElement).not.toBe(message);
  });

  it("says so when the microphone is refused", async () => {
    enableDictation(() => Promise.reject(new Error("denied")));
    renderPage();

    await record();

    expect(screen.getByRole("alert").textContent).toBe(
      "Microphone access was denied.",
    );
  });
});

describe("Cockpit new session favourites", () => {
  it("picks a favourite's project and saves the star", async () => {
    state.projects = [
      { id: "os", name: "Smartzone OS", path: "/work/os" },
      { id: "recent", name: "Recent", path: "/work/recent" },
    ];
    renderPage();
    const select = screen.getByRole("combobox", {
      name: "Project path",
    }) as HTMLSelectElement;

    fireEvent.click(screen.getByRole("button", { name: "SZ OS" }));
    expect(select.value).toBe("os");
    expect(
      screen
        .getByRole("button", { name: "SZ OS" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.change(select, { target: { value: "recent" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save folder as favorite" }),
    );
    await vi.waitFor(() =>
      expect(state.updateSetting).toHaveBeenCalledWith(
        "cockpitProjectFavorites",
        [
          { path: "/work/os", label: "SZ OS" },
          { path: "/work/fresh", label: "Fresh" },
          { path: "/work/phone", label: "Added on the phone" },
          { path: "/work/recent", label: "Recent" },
        ],
      ),
    );
  });

  it("keeps the star off until the saved favourites are known", () => {
    state.loaded = false;
    state.projects = [{ id: "os", name: "Smartzone OS", path: "/work/os" }];
    renderPage();

    const star = screen.getByRole("button", {
      name: "Save folder as favorite",
    }) as HTMLButtonElement;
    expect(star.disabled).toBe(true);
    fireEvent.click(star);
    expect(state.updateSetting).not.toHaveBeenCalled();
  });

  it("types an unknown folder in and moves to its project once known", () => {
    const { rerender } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Fresh" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Project path",
        }) as HTMLInputElement
      ).value,
    ).toBe("/work/fresh");

    state.projects = [{ id: "fresh", name: "Fresh", path: "/work/fresh" }];
    rerender(
      <MemoryRouter>
        <I18nProvider>
          <CockpitNewSession basePath="" />
        </I18nProvider>
      </MemoryRouter>,
    );
    expect(
      (
        screen.getByRole("combobox", {
          name: "Project path",
        }) as HTMLSelectElement
      ).value,
    ).toBe("fresh");
    expect(screen.queryByRole("textbox", { name: "Project path" })).toBeNull();
  });
});

const claudeProvider = {
  name: "claude",
  displayName: "Claude",
  installed: true,
  authenticated: true,
  enabled: true,
  models: [{ id: "sonnet", name: "Sonnet" }],
};

function dropFileAndStart() {
  state.projects = [{ id: "os", name: "Smartzone OS", path: "/work/os" }];
  state.providers = [claudeProvider];
  renderPage();
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });
  fireEvent.drop(screen.getByRole("form"), {
    dataTransfer: { files: [file], types: ["Files"] },
  });
  expect(screen.getByText("notes.txt")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "First message" }), {
    target: { value: "Look at this" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  return file;
}

describe("Cockpit new session attachments", () => {
  it("creates the session, uploads a dropped file and sends it with the first message", async () => {
    const file = dropFileAndStart();

    await vi.waitFor(() =>
      expect(state.calls).toEqual([
        "POST /projects/os/sessions/create",
        "upload:notes.txt",
        "POST /sessions/s1/messages",
      ]),
    );
    expect(state.startSession).not.toHaveBeenCalled();
    expect(state.upload.mock.calls[0]?.slice(0, 3)).toEqual(["os", "s1", file]);
    const body = JSON.parse(
      (state.fetch.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    expect(body.message).toBe("Look at this");
    expect(
      body.attachments.map((attachment: { path: string }) => attachment.path),
    ).toEqual(["/uploads/s1/f1-notes.txt"]);
  });

  it("gives a stalled upload up and frees the form", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.upload.mockReset().mockImplementation(() => new Promise(() => {}));
      dropFileAndStart();
      await vi.waitFor(() => expect(state.upload).toHaveBeenCalled());

      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(/upload/i),
      );
      expect(state.calls).not.toContain("POST /sessions/s1/messages");
      expect(
        (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("withdraws a creation the host only queued instead of uploading", async () => {
    state.createResponse = { queued: true, queueId: "q1", position: 1 };
    dropFileAndStart();

    await vi.waitFor(() =>
      expect(state.calls).toEqual([
        "POST /projects/os/sessions/create",
        "DELETE /queue/q1",
      ]),
    );
    expect(state.upload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Server is busy. Please try again in a moment.",
    );
  });
});

describe("Cockpit new session keyboard submission", () => {
  it("keeps composition, shifted and repeated Enter in the editor", async () => {
    state.projects = [{ id: "os", name: "Smartzone OS", path: "/work/os" }];
    state.providers = [claudeProvider];
    renderPage();
    const input = screen.getByRole("textbox", { name: "First message" });
    fireEvent.change(input, {
      target: { value: "Draft still being composed" },
    });
    for (const flags of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
      { shiftKey: true },
    ]) {
      fireEvent.keyDown(input, { key: "Enter", ...flags });
      expect(state.fetch).not.toHaveBeenCalled();
    }
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Cockpit new session cancel", () => {
  it("leaves to the Cockpit when the form was opened directly", () => {
    render(
      <MemoryRouter initialEntries={["/cockpit?view=new"]}>
        <I18nProvider>
          <Routes>
            <Route element={<CockpitHome />} path="/cockpit" />
          </Routes>
        </I18nProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Cockpit home")).toBeTruthy();
  });
});

function CockpitHome() {
  const location = useLocation();
  return location.search === "?view=new" ? (
    <CockpitNewSession basePath="" />
  ) : (
    <p>Cockpit home</p>
  );
}

describe("Cockpit new session source ownership", () => {
  it.each([false, true])(
    "keeps delayed folder resolution on its original host (files: %s)",
    async (withFile) => {
      state.providers = [claudeProvider];
      let resolveProject!: (value: unknown) => void;
      state.fetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveProject = resolve;
          }),
      );
      const view = renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Fresh" }));
      fireEvent.change(screen.getByRole("textbox", { name: "First message" }), {
        target: { value: "Stay on this host" },
      });
      if (withFile)
        fireEvent.drop(screen.getByRole("form"), {
          dataTransfer: {
            files: [new File(["hello"], "notes.txt", { type: "text/plain" })],
            types: ["Files"],
          },
        });
      fireEvent.click(screen.getByRole("button", { name: "Start session" }));
      expect(state.fetch.mock.calls[0]?.[0]).toBe("/projects");
      state.otherHost = true;
      view.unmount();
      await act(async () => {
        resolveProject({ project: { id: "os" } });
      });
      expect(state.otherFetch).not.toHaveBeenCalled();
      expect(state.fetch.mock.calls[1]?.[0]).toBe(
        withFile ? "/projects/os/sessions/create" : "/projects/os/sessions",
      );
      if (withFile) expect(state.calls).toContain("POST /sessions/s1/messages");
    },
  );
});

it("keeps Android shares queued during startup and accepts them after failure", async () => {
  state.projects = [{ id: "os", name: "Smartzone OS", path: "/work/os" }];
  state.providers = [claudeProvider];
  let rejectStart!: (reason: Error) => void;
  state.fetch.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectStart = reject;
      }),
  );
  const sharedFetch = vi.fn(
    async () => new Response(new Blob(["shared file"])),
  );
  vi.stubGlobal("fetch", sharedFetch);
  renderPage();
  const input = screen.getByRole("textbox", {
    name: "First message",
  }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "Original request" } });
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  window.__yepAppShare = [
    {
      text: "Shared text",
      files: [{ url: "/__yep_app/teilen/id/0", name: "shared.txt" }],
    },
  ];
  await act(async () => {
    window.dispatchEvent(new Event(COCKPIT_APP_SHARE_EVENT));
  });
  expect(sharedFetch).not.toHaveBeenCalled();
  expect(input.value).toBe("Original request");
  expect(window.__yepAppShare).toHaveLength(1);
  await act(async () => {
    rejectStart(new Error("Try again"));
  });
  expect(input.value).toBe("Original request\n\nShared text");
  expect(screen.getByText("shared.txt")).toBeTruthy();
  expect(window.__yepAppShare).toEqual([]);
});
