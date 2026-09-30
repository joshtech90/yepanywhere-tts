import type { StoredSession } from "../SecureConnection";
import type { SecureConnectionSocket } from "../SecureConnectionSocket";
import {
  decryptBinaryEnvelope,
  deriveTransportKey,
  encrypt,
  encryptToBinaryEnvelope,
} from "../nacl-wrapper";

export const resumeSession: StoredSession = {
  wsUrl: "ws://test-server/api/ws",
  username: "test-host",
  sessionId: "test-session",
  sessionKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  resumeProtocolVersion: 3,
};

/** Script only the wire; production resume/proof/encryption code stays real. */
export class ScriptedResumeSocket implements SecureConnectionSocket {
  bufferedAmount = 0;
  binaryType: BinaryType = "arraybuffer";
  readyState = 1;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  mode: "ok" | "silent" | "silent-proof" | "rejected" | "bad-proof" = "ok";
  sent: unknown[] = [];
  subscriptions = new Set<string>();
  private clientNonce = "";
  private nonce = btoa(String.fromCharCode(...new Uint8Array(24).fill(9)));
  private key = new Uint8Array(32).fill(7);
  private transportKey = deriveTransportKey(this.key, this.nonce);
  private seq = 0;

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  event(subscriptionId: string, eventType = "heartbeat"): void {
    this.encrypted({
      type: "event",
      subscriptionId,
      eventType,
      data: { timestamp: "test" },
    });
  }

  private encrypted(msg: unknown): void {
    this.onmessage?.({
      data: encryptToBinaryEnvelope(
        JSON.stringify({ seq: this.seq++, msg }),
        this.transportKey,
      ),
    } as MessageEvent);
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    const message =
      typeof data === "string"
        ? JSON.parse(data)
        : JSON.parse(
            decryptBinaryEnvelope(data as ArrayBuffer, this.transportKey) ??
              "{}",
          ).msg;
    this.sent.push(message);
    queueMicrotask(() => {
      if (this.readyState !== 1 || this.mode === "silent") return;
      if (message.type === "srp_resume_init") {
        this.clientNonce = message.clientNonce;
        if (this.mode === "rejected") {
          this.receive({ type: "srp_invalid", reason: "expired" });
        } else {
          this.receive({
            type: "srp_resume_challenge",
            sessionId: resumeSession.sessionId,
            nonce: this.nonce,
          });
        }
      } else if (
        message.type === "srp_resume" &&
        this.mode !== "silent-proof"
      ) {
        this.receive({
          type: "srp_resumed",
          sessionId: resumeSession.sessionId,
          transportNonce: this.nonce,
          serverProof:
            this.mode === "bad-proof"
              ? "invalid"
              : JSON.stringify(
                  encrypt(
                    JSON.stringify({
                      type: "srp_resume_server_proof",
                      sessionId: resumeSession.sessionId,
                      clientNonce: this.clientNonce,
                      serverNonce: this.nonce,
                      resumeProtocolVersion: 3,
                    }),
                    this.key,
                  ),
                ),
        });
      } else if (message.type === "request") {
        this.encrypted({
          type: "response",
          id: message.id,
          status: 200,
          headers: {},
          body: { authenticated: true },
        });
      } else if (message.type === "subscribe") {
        this.subscriptions.add(message.subscriptionId);
        this.event(message.subscriptionId, "connected");
      } else if (message.type === "ping") {
        this.encrypted({ type: "pong", id: message.id });
      }
    });
  }
}
