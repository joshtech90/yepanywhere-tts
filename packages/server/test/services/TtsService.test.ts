import { mkdtemp, writeFile } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtsService } from "../../src/services/TtsService.js";

interface Stub {
  server: Server;
  url: string;
  seenAuth: string[];
  seenText: string[];
  seenBodies: Record<string, unknown>[];
}

async function startStub(options: {
  healthy: boolean;
  ttsStatus?: number;
  contentType?: string;
  audio?: string;
}): Promise<Stub> {
  const seenAuth: string[] = [];
  const seenText: string[] = [];
  const seenBodies: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    seenAuth.push(req.headers.authorization ?? "");
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      if (req.url === "/health") {
        res.writeHead(options.healthy ? 200 : 503, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ ok: options.healthy }));
        return;
      }
      if (req.url === "/tts") {
        const parsed = JSON.parse(body);
        seenBodies.push(parsed);
        seenText.push(parsed.text);
        const status = options.ttsStatus ?? 200;
        if (status !== 200) {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "session_expired" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": options.contentType ?? "audio/ogg",
        });
        res.end(Buffer.from(options.audio ?? "OggS-fake-audio"));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    seenAuth,
    seenText,
    seenBodies,
  };
}

// Nothing listens on the discard port: a test never reaches a real service.
const UNREACHABLE = "http://127.0.0.1:9";

describe("TtsService with the Gemini read-aloud service", () => {
  let stub: Stub | null = null;
  let grok: Stub | null = null;
  let dataDir: string;
  const envBefore = { ...process.env };

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "tts-test-"));
    process.env.TTS_GEMINI_TOKEN_FILE = path.join(dataDir, "no-token");
    process.env.TTS_GROK_TOKEN_FILE = path.join(dataDir, "no-token");
    process.env.TTS_GROK_URL = UNREACHABLE;
    process.env.TTS_GEMINI_URL = UNREACHABLE;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...envBefore };
    for (const running of [stub, grok]) {
      if (running) await new Promise((r) => running.server.close(r));
    }
    stub = null;
    grok = null;
  });

  it("reads with the Grok voice Leo first and reports MP3 audio", async () => {
    grok = await startStub({
      healthy: true,
      contentType: "audio/mpeg",
      audio: "ID3-grok-audio",
    });
    stub = await startStub({ healthy: true });
    process.env.TTS_GROK_URL = grok.url;
    process.env.TTS_GEMINI_URL = stub.url;
    const tts = new TtsService({ dataDir });
    await tts.initialize();

    expect(tts.getStatus()).toMatchObject({
      enabled: true,
      backend: "grok_web",
    });
    const result = await tts.synthesizeAudio("**Hallo** Welt");
    expect(result).toEqual({
      audio: Buffer.from("ID3-grok-audio"),
      mimeType: "audio/mpeg",
    });
    expect(grok.seenBodies).toEqual([
      {
        text: "Hallo Welt",
        voice: "leo",
        lang: "de",
        format: "mp3",
        stream: false,
      },
    ]);
    expect(stub.seenText).toEqual([]);
  });

  it("falls back to Gemini when Grok fails to synthesize", async () => {
    grok = await startStub({ healthy: true, ttsStatus: 503 });
    stub = await startStub({ healthy: true });
    process.env.TTS_GROK_URL = grok.url;
    process.env.TTS_GEMINI_URL = stub.url;
    const tts = new TtsService({ dataDir });
    await tts.initialize();

    const result = await tts.synthesizeAudio("Test");
    expect(result.mimeType).toBe("audio/ogg");
    expect(stub.seenText).toEqual(["Test"]);
    // The failed service counts as down until its next health check.
    expect(tts.getStatus().backend).toBe("gemini_web");
  });

  it("uses Gemini while Grok is logged out", async () => {
    grok = await startStub({ healthy: false });
    stub = await startStub({ healthy: true });
    process.env.TTS_GROK_URL = grok.url;
    process.env.TTS_GEMINI_URL = stub.url;
    const tts = new TtsService({ dataDir });
    await tts.initialize();

    expect(tts.getStatus().backend).toBe("gemini_web");
    expect((await tts.synthesizeAudio("Test")).mimeType).toBe("audio/ogg");
    expect(grok.seenText).toEqual([]);
  });

  it("sends each service its own bearer token", async () => {
    grok = await startStub({ healthy: true, contentType: "audio/mpeg" });
    const tokenFile = path.join(dataDir, "grok-token");
    await writeFile(tokenFile, "grok-token-fuer-den-test\n");
    process.env.TTS_GROK_URL = grok.url;
    process.env.TTS_GROK_TOKEN_FILE = tokenFile;
    const tts = new TtsService({ dataDir });
    await tts.initialize();
    await tts.synthesizeAudio("Test");
    expect(grok.seenAuth.length).toBeGreaterThan(0);
    expect(
      grok.seenAuth.every((a) => a === "Bearer grok-token-fuer-den-test"),
    ).toBe(true);
  });

  it("uses Gemini first and reports Ogg audio", async () => {
    stub = await startStub({ healthy: true });
    process.env.TTS_GEMINI_URL = stub.url;
    const tts = new TtsService({ dataDir });
    await tts.initialize();

    expect(tts.getStatus()).toMatchObject({
      enabled: true,
      backend: "gemini_web",
    });
    const result = await tts.synthesizeAudio("**Hallo** `code` Welt");
    expect(result.mimeType).toBe("audio/ogg");
    expect(result.audio.toString()).toBe("OggS-fake-audio");
    expect(stub.seenText).toEqual(["Hallo Welt"]);
  });

  it("sends the bearer token when a token file exists", async () => {
    stub = await startStub({ healthy: true });
    const tokenFile = path.join(dataDir, "token");
    await writeFile(tokenFile, "geheimes-token-fuer-den-test\n");
    process.env.TTS_GEMINI_URL = stub.url;
    process.env.TTS_GEMINI_TOKEN_FILE = tokenFile;
    const tts = new TtsService({ dataDir });
    await tts.initialize();
    await tts.synthesizeAudio("Test");
    expect(
      stub.seenAuth.every((a) => a === "Bearer geheimes-token-fuer-den-test"),
    ).toBe(true);
  });

  it("is disabled when Gemini is down and no Cloud credentials exist", async () => {
    stub = await startStub({ healthy: false });
    process.env.TTS_GEMINI_URL = stub.url;
    const tts = new TtsService({ dataDir });
    await tts.initialize();
    expect(tts.getStatus().enabled).toBe(false);
    await expect(tts.synthesizeAudio("Test")).rejects.toThrow();
  });

  it("surfaces the Gemini error when synthesis fails without a fallback", async () => {
    stub = await startStub({ healthy: true, ttsStatus: 503 });
    process.env.TTS_GEMINI_URL = stub.url;
    const tts = new TtsService({ dataDir });
    await tts.initialize();
    await expect(tts.synthesizeAudio("Test")).rejects.toThrow(/HTTP 503/);
  });

  it("allows longer texts while Gemini is healthy", async () => {
    stub = await startStub({ healthy: true });
    process.env.TTS_GEMINI_URL = stub.url;
    const tts = new TtsService({ dataDir });
    await tts.initialize();
    const long = "Satz eins. ".repeat(1000); // ~11000 chars
    const joined = tts.planChunks(long).join(" ");
    expect(joined.length).toBeGreaterThan(5000);
  });

  it("joins a pending recovery check before choosing the synthesis backend", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: false }, { status: 503 }));
    const grokDown = () =>
      Promise.resolve(Response.json({ ok: false }, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    // Only Gemini answers through the mock; Grok stays down.
    process.env.TTS_GEMINI_URL = "http://gemini.invalid";
    const tts = new TtsService({ dataDir });
    await tts.initialize();

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    let finishHealth!: (response: Response) => void;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith(UNREACHABLE)) return grokDown();
      if (String(url).endsWith("/health")) {
        return new Promise((resolve) => {
          finishHealth = resolve;
        });
      }
      return new Response("OggS-recovered");
    });

    // Status starts a refresh; playback arrives before that refresh finishes.
    tts.getStatus();
    const audio = Promise.allSettled([
      tts.synthesizeAudio("Erster Abschnitt"),
      tts.synthesizeAudio("Zweiter Abschnitt"),
    ]);
    finishHealth(Response.json({ ok: true }));
    const results = await audio;
    expect(results).toEqual([
      {
        status: "fulfilled",
        value: { audio: Buffer.from("OggS-recovered"), mimeType: "audio/ogg" },
      },
      {
        status: "fulfilled",
        value: { audio: Buffer.from("OggS-recovered"), mimeType: "audio/ogg" },
      },
    ]);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) =>
          String(url).endsWith("/health") &&
          !String(url).startsWith(UNREACHABLE),
      ),
    ).toHaveLength(2);
  });
});
