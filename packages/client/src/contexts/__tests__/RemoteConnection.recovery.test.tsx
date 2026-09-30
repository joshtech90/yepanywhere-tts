// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RemoteConnectionProvider,
  useRemoteConnection,
} from "../RemoteConnectionContext";
import { RelayConnectionGate } from "../../pages/RelayConnectionGate";
import { openRelayClientSocket } from "../../lib/connection/RelayClientSocket";
import {
  ScriptedResumeSocket,
  resumeSession,
} from "../../lib/connection/__tests__/ScriptedResumeSocket";
import {
  getSourceRuntimeRegistry,
  resetSourceRuntimeRegistryForTests,
} from "../../lib/sourceRuntime";
import { getHostByRelayUsername, upsertRelayHost } from "../../lib/hostStorage";
import { resolveSourceKeyForSavedHost } from "../../lib/sourceIdentity";
import { createManagedStream } from "../../lib/transport/ManagedStream";

// Mock only the paired socket acquisition and unrelated app shell, not the
// context, SRP implementation, transport, manager, route gate, or storage.
vi.mock("../../lib/connection/RelayClientSocket", () => ({
  openRelayClientSocket: vi.fn(),
}));
vi.mock("../../RemoteApp", () => ({
  ConnectedAppContent: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const credentialsKey = "yep-anywhere-remote-credentials";
const relayUrl = "wss://test-relay/ws";
let host: ReturnType<typeof upsertRelayHost>;
let sockets: ScriptedResumeSocket[];
let mode: ScriptedResumeSocket["mode"] | "offline";

async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}
function Page() {
  const { connection } = useRemoteConnection();
  const [draft, setDraft] = useState("");
  const [events, setEvents] = useState(0);
  useEffect(() => {
    const transport = getSourceRuntimeRegistry().getOrCreateSourceTransport(
      resolveSourceKeyForSavedHost(host),
    );
    const stream = createManagedStream(transport, {
      subscribe: ({ handlers }) => transport.subscribeActivity(handlers),
      onEvent: () => setEvents((n) => n + 1),
    });
    stream.start();
    return () => stream.close();
  }, []);
  return (
    <>
      <textarea
        aria-label="Draft"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <output data-testid="events">{events}</output>
      <output>{connection ? "attached" : "detached"}</output>
    </>
  );
}
function App() {
  return (
    <MemoryRouter initialEntries={["/-/relay/test-host/inbox"]}>
      <RemoteConnectionProvider>
        <Routes>
          <Route
            path="/-/relay/:relayUsername"
            element={<RelayConnectionGate />}
          >
            <Route path="inbox" element={<Page />} />
          </Route>
          <Route path="/login/relay" element={<div>Login route</div>} />
        </Routes>
      </RemoteConnectionProvider>
    </MemoryRouter>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  // Node's TextEncoder returns a different realm's Uint8Array under jsdom.
  // Convert at the test boundary so real NaCl receives this realm's arrays.
  const Encoder = TextEncoder;
  vi.stubGlobal(
    "TextEncoder",
    class extends Encoder {
      encode(text?: string) {
        return Uint8Array.from(super.encode(text));
      }
    },
  );
  localStorage.clear();
  sessionStorage.clear();
  host = upsertRelayHost({
    relayUrl,
    relayUsername: "test-host",
    srpUsername: "test-host",
    session: { ...resumeSession },
  });
  localStorage.setItem(
    credentialsKey,
    JSON.stringify({
      wsUrl: relayUrl,
      username: "test-host",
      mode: "relay",
      relayUsername: "test-host",
      session: resumeSession,
    }),
  );
  getSourceRuntimeRegistry().registerSourceTransport(
    resolveSourceKeyForSavedHost(host),
    {
      kind: "secure",
      options: {
        connectionManagerConfig: {
          maxAttempts: 1,
          baseDelayMs: 1,
          jitterFactor: 0,
        },
      },
    },
  );
  sockets = [];
  mode = "ok";
  vi.mocked(openRelayClientSocket).mockImplementation(async () => {
    if (mode === "offline")
      throw new Error("Failed to connect to relay server");
    const socket = new ScriptedResumeSocket();
    socket.mode = mode;
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
});
afterEach(() => {
  cleanup();
  resetSourceRuntimeRegistryForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("remote recovery ownership", () => {
  it("retains context, draft and storage across exhausted retries and restores live subscriptions", async () => {
    render(<App />);
    await flush();
    expect(screen.getByText("attached")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "unsaved" },
    });
    mode = "offline";
    act(() => sockets[0]?.close(1006));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flush();
    expect(screen.getByText("attached")).toBeTruthy();
    expect(
      JSON.parse(localStorage.getItem(credentialsKey) ?? "{}").session
        .sessionId,
    ).toBe(resumeSession.sessionId);
    mode = "ok";
    act(() => window.dispatchEvent(new Event("online")));
    await flush();
    expect(sockets).toHaveLength(2);
    expect((screen.getByLabelText("Draft") as HTMLTextAreaElement).value).toBe(
      "unsaved",
    );
    const latest = sockets[1]!;
    expect(latest.subscriptions.size).toBe(1);
    const before = Number(screen.getByTestId("events").textContent);
    await act(async () => {
      latest.event([...latest.subscriptions][0]!);
    });
    await flush();
    expect(Number(screen.getByTestId("events").textContent)).toBeGreaterThan(
      before,
    );
  });

  it("keeps both stored credentials after resume timeout and recovers without login", async () => {
    mode = "silent";
    render(<App />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await flush();
    expect(screen.queryByText("Login route")).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(credentialsKey) ?? "{}").session
        .sessionId,
    ).toBe(resumeSession.sessionId);
    expect(getHostByRelayUsername("test-host")?.session?.sessionId).toBe(
      resumeSession.sessionId,
    );
    const retry = screen.getByRole("button", { name: "hostOfflineRetry" });
    fireEvent.pointerDown(retry);
    fireEvent.keyDown(retry, { key: "Enter" });
    await flush();
    expect(screen.getByRole("button", { name: "hostOfflineRetry" })).toBe(
      retry,
    );
    expect(sockets).toHaveLength(1);
    mode = "ok";
    act(() => window.dispatchEvent(new Event("online")));
    await flush();
    expect(screen.getByText("attached")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains an explicit rejection and does not automatically retry it", async () => {
    mode = "rejected";
    render(<App />);
    await flush();
    expect(
      screen.getByText("Server rejected session resume: expired"),
    ).toBeTruthy();
    expect(getHostByRelayUsername("test-host")?.session).toBeUndefined();
    expect(
      JSON.parse(localStorage.getItem(credentialsKey) ?? "{}").session,
    ).toBeUndefined();
    act(() => window.dispatchEvent(new Event("online")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(sockets).toHaveLength(1);
  });
});
