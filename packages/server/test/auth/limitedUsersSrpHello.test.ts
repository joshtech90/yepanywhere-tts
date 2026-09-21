import { describe, expect, it } from "vitest";
import { createConnectionState } from "../../src/routes/ws-relay-handlers.js";
import {
  type SrpLimitedUserLookup,
  handleSrpHello,
} from "../../src/routes/ws-srp-handlers.js";
import type { WSAdapter } from "../../src/routes/ws-relay-handlers.js";

/**
 * topics/limited-users.md § Delivery v1 — Login, switching, and logout.
 *
 * With limited users enabled, an unknown SRP identity must be answered like a
 * known one and fail only at the proof step. With the feature off — the
 * default — the server keeps its existing behavior of saying the identity is
 * unknown.
 */

function fakeSocket() {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send: (data: string) => {
      sent.push(JSON.parse(data) as Record<string, unknown>);
    },
    close: () => {},
    readyState: 1,
  } as unknown as WSAdapter;
  return { ws, sent };
}

const remoteAccess = {
  getCredentials: () => ({
    // A well-formed hex salt and verifier; the handshake only needs parseable
    // values to compute a challenge.
    salt: "a1b2c3",
    verifier: "9f8e7d6c5b4a3928",
  }),
  getUsername: () => "owner",
} as unknown as Parameters<typeof handleSrpHello>[3];

const decoy: SrpLimitedUserLookup = {
  getSrpChallengeInputs: () => ({
    salt: "d1d2d3",
    verifier: "1122334455667788",
    known: false,
  }),
};

const featureOff: SrpLimitedUserLookup = {
  getSrpChallengeInputs: () => undefined,
};

describe("srp_hello identity handling", () => {
  it("challenges an unknown identity when limited users are enabled", async () => {
    const { ws, sent } = fakeSocket();
    await handleSrpHello(
      ws,
      createConnectionState(),
      { type: "srp_hello", identity: "mallory", A: "01" } as never,
      remoteAccess,
      decoy,
    );
    expect(sent.map((message) => message.type)).toEqual(["srp_challenge"]);
  });

  it("still reports an unknown identity while the feature is off", async () => {
    const { ws, sent } = fakeSocket();
    await handleSrpHello(
      ws,
      createConnectionState(),
      { type: "srp_hello", identity: "mallory", A: "01" } as never,
      remoteAccess,
      featureOff,
    );
    expect(sent).toEqual([
      {
        type: "srp_error",
        code: "invalid_identity",
        message: "Unknown identity",
      },
    ]);
  });

  it("pads the unknown-identity response to the fixed floor", async () => {
    const { ws } = fakeSocket();
    const startedAt = Date.now();
    await handleSrpHello(
      ws,
      createConnectionState(),
      { type: "srp_hello", identity: "mallory", A: "01" } as never,
      remoteAccess,
      featureOff,
    );
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
  });
});
