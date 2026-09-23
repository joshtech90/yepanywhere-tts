import { mkdtemp, writeFile } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TtsService } from "../../src/services/TtsService.js";

interface Stub {
  server: Server;
  url: string;
  seenAuth: string[];
  seenText: string[];
}

async function startStub(options: {
  healthy: boolean;
  ttsStatus?: number;
}): Promise<Stub> {
  const seenAuth: string[] = [];
  const seenText: string[] = [];
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
        seenText.push(JSON.parse(body).text);
        const status = options.ttsStatus ?? 200;
        if (status !== 200) {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "session_expired" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "audio/ogg" });
        res.end(Buffer.from("OggS-fake-audio"));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, seenAuth, seenText };
}

describe("TtsService with the Gemini read-aloud service", () => {
  let stub: Stub | null = null;
  let dataDir: string;
  const envBefore = { ...process.env };

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "tts-test-"));
    process.env.TTS_GEMINI_TOKEN_FILE = path.join(dataDir, "no-token");
  });

  afterEach(async () => {
    process.env = { ...envBefore };
    if (stub) await new Promise((r) => stub?.server.close(r));
    stub = null;
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
});
