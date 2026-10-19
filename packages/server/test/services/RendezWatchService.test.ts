import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import type { RendezSessions } from "../../src/services/RendezObserver.js";
import { RendezWatchService } from "../../src/services/RendezWatchService.js";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { subscribe } from "../../src/services/rendez-protocol.mjs";

const profile = { maxLongEdge: 2000, maxBytes: 4 * 1024 * 1024, quality: 85 };
const target = {
  harness: "claude",
  providerSessionId: "session-a",
  yaSessionId: "session-a",
  liveOnly: true,
};
// Uploads settle after one quiet second, so allow several.
const wait = { timeout: 8000, interval: 50 };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function readMarker(root: string) {
  return JSON.parse(await readFile(join(root, ".observer.json"), "utf8"));
}

async function harness(maxPerWindow = 10) {
  const project = await realpath(await mkdtemp(join(tmpdir(), "rendez-")));
  const root = join(project, ".rendez");
  const sent: Array<{ id: string; text: string }> = [];
  const sessions: RendezSessions = {
    async route() {
      return {
        transport: "ya",
        profile,
        async send(id, text) {
          sent.push({ id, text });
          return { accepted: true };
        },
      };
    },
    async turnStatus() {
      return null;
    },
  };
  const settings = new ServerSettingsService({ dataDir: project });
  await settings.initialize();
  const userTurnListeners = new Set<(projectPath: string) => void>();
  /** An actual user message to a session in the project. */
  const message = () => {
    for (const listener of userTurnListeners) listener(project);
  };
  const userTurns = (listener: (projectPath: string) => void) => {
    userTurnListeners.add(listener);
    return () => userTurnListeners.delete(listener);
  };
  let service: RendezWatchService | undefined;
  /** Apply settings afresh, which makes the service reconcile now. */
  const refresh = () =>
    settings.updateSettings({
      rendez: {
        enabled: true,
        projects: {},
        windowMs: 60_000,
        maxPerWindow,
      },
    });
  const start = async ({ owned = true } = {}) => {
    service = new RendezWatchService(
      settings,
      async () => [{ path: project }],
      sessions,
      userTurns,
    );
    await refresh();
    // A first watcher waits for a user message; a restart finds .rendez.
    message();
    if (owned) {
      await vi.waitFor(async () => {
        expect((await readMarker(root)).pid).toBe(process.pid);
        // Ownership is published before route watches finish attaching.
        expect(service?.status().watching).toContain(project);
      }, wait);
    }
  };
  const stop = async () => {
    await service?.close();
    service = undefined;
  };
  cleanups.push(async () => {
    await stop();
    await rm(project, { recursive: true, force: true });
  });
  return {
    project,
    root,
    sent,
    settings,
    sessions,
    userTurns,
    message,
    start,
    stop,
    refresh,
    service: () => service,
  };
}

it.skipIf(process.platform === "win32")(
  "attaches a project only after a user message following its turn-on",
  async () => {
    const { project, root, settings, sessions, userTurns, message } =
      await harness();
    const exists = () =>
      lstat(root).then(
        () => true,
        () => false,
      );
    const apply = (enabled: boolean, projects: Record<string, boolean> = {}) =>
      settings.updateSettings({ rendez: { enabled, projects } });
    const quiet = () => new Promise((resolve) => setTimeout(resolve, 300));
    // A message before the project is turned on does not count.
    const service = new RendezWatchService(
      settings,
      async () => [{ path: project }],
      sessions,
      userTurns,
    );
    cleanups.push(() => service.close());
    message();
    // Trying settings out leaves nothing in the project.
    await apply(true);
    await apply(false, { [project]: true });
    await apply(false);
    await apply(false, { [project]: true });
    await quiet();
    expect(await exists()).toBe(false);
    expect(service.status().watching).toEqual([]);

    message();
    await vi.waitFor(async () => {
      expect((await readMarker(root)).pid).toBe(process.pid);
      expect(service.status().watching).toEqual([project]);
    }, wait);

    // Turning it off stops the observer and keeps its files.
    await apply(false);
    await vi.waitFor(() => expect(service.status().watching).toEqual([]), wait);
    expect(await exists()).toBe(true);
  },
  20_000,
);

async function upload(inbox: string, name: string, bytes: Buffer) {
  // Senders publish completed files by renaming a hidden temporary.
  await writeFile(join(inbox, `.${name}.part`), bytes);
  await rename(join(inbox, `.${name}.part`), join(inbox, name));
}

async function records(root: string) {
  const directory = join(root, "delivered", "session-a");
  return Promise.all(
    (await readdir(directory))
      .filter((name) => !name.startsWith("."))
      .map(async (name) =>
        JSON.parse(
          await readFile(join(directory, name, "record.json"), "utf8"),
        ),
      ),
  );
}

it.skipIf(process.platform === "win32")(
  "delivers a prepared upload once, including across a restart",
  async () => {
    const { root, sent, start, stop } = await harness();
    await start();
    // A user turn through YA points latest-session at the session.
    await subscribe(root, target, { latest: true, receivedAt: 100 });
    const inbox = join(root, "latest-session");
    const original = await sharp({
      create: { width: 3000, height: 1200, channels: 3, background: "#58a" },
    })
      .png()
      .toBuffer();
    await upload(inbox, "screenshot.png", original);
    await vi.waitFor(() => expect(sent).toHaveLength(1), wait);
    const record = await vi.waitFor(async () => {
      const [record] = await records(root);
      expect(record).toMatchObject({
        state: "accepted",
        transport: "ya",
        width: 2000,
        height: 800,
        originalName: "screenshot.png",
      });
      return record;
    }, wait);
    expect(sent[0]?.text).toContain(
      `User uploaded files:\n- [screenshot.png](<${record.path}>)`,
    );
    expect(await readFile(join(inbox, "screenshot.png"))).toEqual(original);

    await stop();
    await start();
    // The restarted observer neither resends nor misses a changed upload.
    await writeFile(
      join(inbox, "screenshot.png"),
      await sharp({
        create: { width: 300, height: 200, channels: 3, background: "#a85" },
      })
        .png()
        .toBuffer(),
    );
    await vi.waitFor(() => expect(sent).toHaveLength(2), wait);
    expect((await records(root)).map((r) => r.width).sort()).toEqual([
      2000, 300,
    ]);
  },
  20_000,
);

it.skipIf(process.platform === "win32")(
  "holds a burst beyond the window budget and sends one notice",
  async () => {
    const { root, sent, start } = await harness(2);
    // Exercise burst admission with an existing route. The ownership marker
    // precedes watch readiness; live-route discovery is covered above.
    await mkdir(root);
    const { path: inbox } = await subscribe(root, target);
    await start();
    for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
      await upload(inbox, name, Buffer.from(name));
    }
    await vi.waitFor(() => expect(sent).toHaveLength(3), wait);
    await vi.waitFor(async () => {
      const states = (await records(root)).map((record) =>
        record.kind === "overload" ? "notice" : record.state,
      );
      expect(states.sort()).toEqual([
        "accepted",
        "accepted",
        "held",
        "held",
        "notice",
      ]);
    }, wait);
    expect(sent.map(({ text }) => text).join("\n")).toContain(
      "potentially unintentionally",
    );
  },
  20_000,
);

it.skipIf(process.platform !== "linux")(
  "defers to another live observer and never resends a claimed upload",
  async () => {
    const { root, sent, start, stop, refresh } = await harness();
    await start();
    await stop();
    const { path: inbox } = await subscribe(root, target);
    // A live observer elsewhere on this host serves the project.
    const other = {
      owner: "rendez watch --turns",
      host: hostname(),
      pid: process.ppid,
    };
    await writeFile(join(root, ".observer.json"), JSON.stringify(other));
    await upload(inbox, "notes.txt", Buffer.from("for the other observer"));
    await start({ owned: false });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(sent).toHaveLength(0);
    expect(await readMarker(root)).toEqual(other);
    // Once it is gone, the next check takes over and delivers.
    await rm(join(root, ".observer.json"));
    await refresh();
    await vi.waitFor(() => expect(sent).toHaveLength(1), wait);

    // A claimed upload whose sender stopped before recording an outcome
    // may already have been sent, so it becomes uncertain instead.
    const [record] = await records(root);
    await writeFile(
      join(root, "delivered", "session-a", record.id, "record.json"),
      JSON.stringify({ ...record, state: "pending" }),
    );
    await stop();
    await start();
    await vi.waitFor(
      async () => expect((await records(root))[0]?.state).toBe("uncertain"),
      wait,
    );
    expect(sent).toHaveLength(1);
  },
  20_000,
);

it.skipIf(process.platform === "win32")(
  "delivers nested files, skips unchanged originals, and sets aside an unlistened latest-session",
  async () => {
    const { root, sent, start, stop } = await harness();
    await start();
    const latest = join(root, "latest-session");
    // Before any session is messaged the pointer leads nowhere, so senders
    // fail instead of creating a directory.
    await vi.waitFor(
      async () =>
        expect(await readlink(latest)).toBe(".no-session-messaged-yet/inbox"),
      wait,
    );
    await subscribe(root, target, { latest: true, receivedAt: 100 });
    await stop();
    // rsync into a missing pointer creates a real directory; its files
    // arrived with nobody listening and are moved aside undelivered.
    await unlink(latest);
    await mkdir(latest);
    await writeFile(join(latest, "early.txt"), "before anyone listened");
    await start();
    // The marker start() awaits precedes this repair, so wait for it too.
    await vi.waitFor(
      async () => expect((await lstat(latest)).isSymbolicLink()).toBe(true),
      wait,
    );
    const [aside] = await readdir(join(root, "unrouted"));
    expect(await readdir(join(root, "unrouted", aside ?? ""))).toEqual([
      "early.txt",
    ]);

    // A folder created while watching is watched; each file in it is
    // delivered under its inbox-relative name.
    await mkdir(join(latest, "123", "456"), { recursive: true });
    const part = join(latest, "123", "456", ".notes.part");
    await writeFile(part, "first");
    await utimes(part, 1000, 1000);
    await rename(part, join(latest, "123", "456", "notes.txt"));
    await vi.waitFor(() => expect(sent).toHaveLength(1), wait);
    expect(sent[0]?.text).toContain("[123/456/notes.txt]");

    // Same size and mtime is rsync's test for unchanged: not reread, even
    // though the bytes differ.
    await stop();
    const notes = join(latest, "123", "456", "notes.txt");
    await writeFile(notes, "other");
    await utimes(notes, 1000, 1000);
    await start();
    await writeFile(notes, "changed");
    await vi.waitFor(() => expect(sent).toHaveLength(2), wait);
    expect(sent[1]?.text).toContain("[123/456/notes.txt]");
  },
  20_000,
);
