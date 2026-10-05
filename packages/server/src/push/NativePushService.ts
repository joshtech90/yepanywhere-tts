import type { NativePushVersionInfo } from "@yep-anywhere/shared";
import { createHash } from "node:crypto";
import type {
  SecurityClientService,
  StoredNativePushSubscription,
} from "../services/SecurityClientService.js";
import type { PushPayload, SendResult } from "./types.js";

export function normalizeNativePushBroker(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Native push broker must be an HTTPS origin");
  }
  return url.origin;
}

/** Optional delivery adapter; no provider credentials, retry timers or durable queue. */
export class NativePushService {
  readonly brokerUrl: string;
  private readonly active = new Set<string>();
  private readonly lifetime = new AbortController();
  constructor(
    private readonly clients: SecurityClientService,
    brokerUrl = process.env.YEP_NATIVE_PUSH_BROKER_URL ??
      "https://push.yepanywhere.com",
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.brokerUrl = normalizeNativePushBroker(brokerUrl);
  }
  version(): NativePushVersionInfo {
    return {
      protocolVersion: 1,
      brokerUrl: this.brokerUrl,
      privacyModes: ["generic"],
    };
  }
  count(): number {
    return this.clients.nativePushDestinations(this.brokerUrl).length;
  }
  shutdown(): void {
    this.lifetime.abort();
  }
  async sendToAll(payload: PushPayload): Promise<SendResult[]> {
    let intent: string;
    if (payload.type === "pending-input")
      intent =
        payload.inputType === "tool-approval"
          ? "approval_required"
          : "input_required";
    else if (payload.type === "session-halted")
      intent =
        payload.reason === "error" ? "session_failed" : "session_completed";
    else return [];
    return Promise.all(
      this.clients
        .nativePushDestinations(this.brokerUrl)
        .map(({ clientId, subscription }) =>
          this.send(
            clientId,
            subscription,
            intent,
            false,
            "sessionId" in payload ? payload.sessionId : undefined,
            payload.timestamp,
            "projectId" in payload ? payload.projectId : undefined,
          ),
        ),
    );
  }
  async test(clientId: string): Promise<SendResult> {
    const subscription = this.clients
      .nativePushDestinations(this.brokerUrl)
      .find((entry) => entry.clientId === clientId)?.subscription;
    if (!subscription)
      return {
        browserProfileId: clientId,
        success: false,
        error: "native_push_not_enrolled",
      };
    return this.send(clientId, subscription, "input_required", true);
  }
  private async send(
    clientId: string,
    subscription: StoredNativePushSubscription,
    intent: string,
    test = false,
    sessionId?: string,
    timestamp?: string,
    projectId?: string,
  ): Promise<SendResult> {
    const result: SendResult = { browserProfileId: clientId, success: false };
    if (
      this.lifetime.signal.aborted ||
      this.active.has(clientId) ||
      this.active.size >= 16
    )
      return { ...result, error: "native_push_busy" };
    this.active.add(clientId);
    let invalid = false;
    try {
      if (!this.clients.isCurrentNativePush(clientId, subscription))
        return { ...result, error: "native_push_not_enrolled" };
      if (sessionId && projectId)
        await this.clients.rememberNativePushDestination(
          clientId,
          subscription,
          sessionId,
          projectId,
        );
      if (!this.clients.isCurrentNativePush(clientId, subscription))
        return { ...result, error: "native_push_not_enrolled" };
      const response = await this.fetcher(
        `${this.brokerUrl}/v1/subscriptions/${subscription.subscriptionId}/notifications`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${subscription.sendSecret}`,
          },
          body: JSON.stringify({
            intent,
            ...(sessionId && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
              ? { sessionId }
              : {}),
            ...(timestamp
              ? {
                  eventId: createHash("sha256")
                    .update(`${intent}:${sessionId ?? ""}:${timestamp}`)
                    .digest("base64url"),
                }
              : {}),
            ...(test ? { test: true } : {}),
          }),
          signal: AbortSignal.any([
            this.lifetime.signal,
            AbortSignal.timeout(10000),
          ]),
        },
      );
      await response.body?.cancel();
      result.success = response.status === 202;
      invalid = response.status === 404;
      if (!result.success)
        result.error = invalid
          ? "native_push_invalid_subscription"
          : "native_push_delivery_failed";
    } catch {
      // Network errors can contain request URLs; never log credentials or provider bodies.
      result.error = "native_push_delivery_failed";
    } finally {
      this.active.delete(clientId);
    }
    if (this.lifetime.signal.aborted) return result;
    await this.clients.recordNativePushResult(clientId, subscription, {
      success: result.success,
      invalid,
      test,
    });
    return result;
  }
}
