import type { HttpBindings } from "@hono/node-server";
import type { RelayResponse } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  createConnectionState,
  createSendFn,
  handleRequest,
} from "../../src/routes/ws-relay-handlers.js";

async function relayResponse(response: Response, query = "") {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.get("/api/file", () => response);
  const state = createConnectionState();
  state.connectionPolicy = "local_unrestricted";
  state.authState = "authenticated";
  const frames: string[] = [];
  const ws = {
    send: (frame: string | Uint8Array) => frames.push(String(frame)),
    close: () => {},
  };
  await handleRequest(
    {
      type: "request",
      id: "download",
      method: "GET",
      path: `/api/file${query}`,
    },
    createSendFn(ws, state),
    ws,
    app,
    "http://localhost",
    state,
  );
  expect(frames).toHaveLength(1);
  return JSON.parse(frames[0]!) as RelayResponse;
}

describe("relay file downloads", () => {
  it.each([
    ["Markdown", "text/markdown", Buffer.from("# Hello\r\n雪 🎉\r\n")],
    ["JSON", "application/json", Buffer.from('{ "n": 9007199254740993 }\n')],
    ["empty text", "text/plain", Buffer.alloc(0)],
    ["non-UTF-8 text", "text/plain", Buffer.from([0xff, 0xfe, 0x61, 0])],
  ])("preserves exact %s download bytes", async (_name, contentType, bytes) => {
    const result = await relayResponse(
      new Response(bytes, { headers: { "Content-Type": contentType } }),
      "?download=true",
    );
    expect(result.status).toBe(200);
    expect(result.headers?.["content-type"]).toBe(contentType);
    expect(result.body).toEqual({
      _binary: true,
      data: bytes.toString("base64"),
    });
  });

  it.each(["attachment", 'Attachment; filename="README.md"'])(
    "honors %s disposition without a download query",
    async (disposition) => {
      const bytes = '{ "original": true }\r\n';
      const result = await relayResponse(
        new Response(bytes, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": disposition,
          },
        }),
      );
      expect(result.body).toEqual({
        _binary: true,
        data: Buffer.from(bytes).toString("base64"),
      });
    },
  );

  it.each(["", "?download=false"])(
    "keeps normal text and JSON viewing for query %s",
    async (query) => {
      const text = await relayResponse(
        new Response("# Read me\n", {
          headers: {
            "Content-Type": "text/markdown",
            "Content-Disposition": 'inline; filename="attachment.md"',
          },
        }),
        query,
      );
      expect(text.body).toBe("# Read me\n");
      const json = await relayResponse(
        Response.json({ content: "# Read me\n" }),
        query,
      );
      expect(json.body).toEqual({ content: "# Read me\n" });
    },
  );

  it.each([400, 403, 404, 500])(
    "preserves JSON and text errors with status %s",
    async (status) => {
      const headers = { "Content-Disposition": "attachment" };
      const json = await relayResponse(
        Response.json({ error: "Download unavailable" }, { status, headers }),
        "?download=true",
      );
      expect(json.status).toBe(status);
      expect(json.body).toEqual({ error: "Download unavailable" });
      const text = await relayResponse(
        new Response("Download unavailable", { status, headers }),
        "?download=true",
      );
      expect(text.status).toBe(status);
      expect(text.body).toBe("Download unavailable");
    },
  );

  it("keeps ordinary image responses binary", async () => {
    const bytes = Buffer.from([137, 80, 78, 71]);
    const result = await relayResponse(
      new Response(bytes, { headers: { "Content-Type": "image/png" } }),
    );
    expect(result.body).toEqual({
      _binary: true,
      data: bytes.toString("base64"),
    });
  });
});
