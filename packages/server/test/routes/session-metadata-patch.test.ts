import { describe, expect, it } from "vitest";
import { parseSessionMetadataPatch } from "../../src/routes/session-metadata-patch.js";

describe("parseSessionMetadataPatch", () => {
  it("rejects empty metadata patches", () => {
    expect(parseSessionMetadataPatch({})).toEqual({
      ok: false,
      status: 400,
      error: "At least one session metadata field must be provided",
    });
  });

  it("normalizes clear values", () => {
    expect(
      parseSessionMetadataPatch({
        parentSessionId: "",
        wakeTurnsEnabled: null,
        promptSuggestionMode: "",
        recapAfterSeconds: "",
      }),
    ).toMatchObject({
      ok: true,
      patch: {
        parentSessionId: null,
        wakeTurnsEnabled: null,
        promptSuggestionMode: null,
        recapAfterSeconds: null,
      },
    });
  });

  it("normalizes a sidebar category and treats a blank one as none", () => {
    expect(
      parseSessionMetadataPatch({ sidebarCategory: "  PII   program " }),
    ).toMatchObject({ ok: true, patch: { sidebarCategory: "PII program" } });
    expect(parseSessionMetadataPatch({ sidebarCategory: "   " })).toMatchObject(
      { ok: true, patch: { sidebarCategory: null } },
    );
    expect(parseSessionMetadataPatch({ sidebarCategory: null })).toMatchObject({
      ok: true,
      patch: { sidebarCategory: null },
    });
    expect(parseSessionMetadataPatch({ sidebarCategory: 7 })).toEqual({
      ok: false,
      status: 400,
      error: "sidebarCategory must be a string or null",
    });
  });

  it("rejects invalid typed fields with route-compatible messages", () => {
    expect(parseSessionMetadataPatch({ heartbeatTurnText: 1 })).toEqual({
      ok: false,
      status: 410,
      error: "Synthetic heartbeat turns have been removed",
    });
    expect(parseSessionMetadataPatch({ parentSessionId: 1 })).toEqual({
      ok: false,
      status: 400,
      error: "parentSessionId must be a string or null",
    });
    expect(parseSessionMetadataPatch({ wakeTurnsEnabled: "yes" })).toEqual({
      ok: false,
      status: 400,
      error: "wakeTurnsEnabled must be a boolean or null",
    });
    expect(
      parseSessionMetadataPatch({ promptSuggestionMode: "helper" }),
    ).toEqual({
      ok: false,
      status: 400,
      error: "promptSuggestionMode must be one of: off, native",
    });
    expect(parseSessionMetadataPatch({ recapAfterSeconds: "soon" })).toEqual({
      ok: false,
      status: 400,
      error: "recapAfterSeconds must be null or a finite number",
    });
  });
});
