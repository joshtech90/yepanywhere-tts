import {
  encodeUploadChunkPayload,
  type GitWorktreeCoverage,
  type RemoteClientMessage,
  type UploadedFile,
  type StagedAttachmentRef,
  type YepMessage,
} from "@yep-anywhere/shared";
import { generateUUID } from "../uuid";
import { RelayProtocol } from "../connection/RelayProtocol";
import { observeRecoverySignals } from "../connection/recoverySignals";
import {
  ConnectionReconnectingError,
  type Connection,
} from "../connection/types";
import {
  NativeTransportBridge,
  NativeOperationError,
  type NativeTransportChannel,
} from "../nativeTransportBridge";
import {
  SourceTransportDisconnectedError,
  SourceTransportDisposedError,
  type SourceTransport,
  type SourceTransportStatusSnapshot,
  type StreamHandlers,
  type SessionSubscriptionOptions,
  type SessionWatchSubscriptionOptions,
  type UploadOptions,
} from "./types";

/** The native core alone owns SRP, encryption, reconnect and socket capabilities. */
export class NativeSourceTransport implements SourceTransport, Connection {
  readonly kind = "secure" as const;
  readonly mode = "secure" as const;
  readonly capabilities = { sameOriginUrls: false };
  readonly bridge: NativeTransportBridge;
  readonly ready: NativeTransportBridge["ready"];
  private readonly protocol: RelayProtocol;
  private readonly listeners = new Set<() => void>();
  private readonly uploads = new Map<
    string,
    {
      resolve: (file: unknown) => void;
      reject: (error: Error) => void;
      onProgress?: (bytes: number) => void;
    }
  >();
  private snapshot: SourceTransportStatusSnapshot = {
    kind: "secure",
    state: "connecting",
    channels: [{ name: "secure-websocket", state: "connecting" }],
  };
  private disposed = false;
  private phase = "CONNECTING";
  private bridgeClosed = false;
  private explicitRecovery = false;
  private recovery: Promise<void> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRecovery = -Infinity;
  private removeRecoverySignals: () => void = () => {};
  private readonly offline = () => {
    if (this.canRecover()) this.setPhase("OFFLINE");
  };
  private readonly online = () => this.recoverIfNeeded(true);
  private readonly visibility = () => {
    this.scheduleRecovery();
    this.recoverIfNeeded();
  };
  onAuthenticationRequired: () => void = () => {};
  readonly status = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener: () => void) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    },
  };

  constructor(channel: NativeTransportChannel) {
    this.bridge = new NativeTransportBridge(channel);
    this.ready = this.bridge.ready;
    this.protocol = new RelayProtocol(
      {
        sendMessage: (message) => this.send(message),
        sendUploadChunk: async () => {
          throw new Error("Use the native upload operation");
        },
        ensureConnected: () => this.ensureReady(),
        isConnected: () => this.snapshot.state === "ready",
        cancelRequest: (id) => this.bridge.cancelRequest(id),
        cancelSubscription: (subscriptionId) =>
          this.send({ type: "unsubscribe", subscriptionId }),
      },
      { logPrefix: "[NativeSource]", debugEnabled: () => false },
    );
    this.bridge.onEvent = (message) => {
      if (message.type === "state") {
        let phase = String(message.phase);
        if (typeof message.recoverable === "boolean")
          this.explicitRecovery = true;
        if (phase === "FAILED" && typeof message.recoverable === "boolean")
          phase = message.recoverable ? "EXHAUSTED" : "TERMINAL_FAILED";
        if (phase === "SUSPENDED") {
          this.bridge.rejectPending(new ConnectionReconnectingError());
        }
        this.setPhase(
          navigator.onLine === false &&
            ![
              "REAUTHENTICATION_REQUIRED",
              "REVOKED",
              "SUSPENDED",
              "TERMINAL_FAILED",
            ].includes(phase)
            ? "OFFLINE"
            : phase,
        );
        return;
      }
      if (message.type === "networkAvailable") {
        this.recoverIfNeeded(true);
        return;
      }
      if (message.type === "subscriptionError") {
        const id = String(message.subscriptionId);
        if (
          typeof message.errorCode === "string" ||
          !(Number(message.status) > 0)
        ) {
          this.failSubscription(
            id,
            typeof message.errorCode === "string"
              ? new NativeOperationError(
                  message.errorCode,
                  String(message.error),
                )
              : new Error(String(message.error)),
          );
        } else {
          this.protocol.routeMessage({
            type: "response",
            id,
            status: Number(message.status),
            body: { error: message.error },
          });
        }
        return;
      }
      if (
        message.type === "upload_progress" ||
        message.type === "upload_complete" ||
        message.type === "upload_error"
      ) {
        const upload = this.uploads.get(String(message.uploadId));
        if (message.type === "upload_progress")
          upload?.onProgress?.(Number(message.bytesReceived));
        else if (message.type === "upload_complete")
          upload?.resolve(message.stagedRef ?? message.file);
        else upload?.reject(new Error(String(message.error)));
        return;
      }
      this.protocol.routeMessage(message as unknown as YepMessage);
    };
    this.bridge.onClose = (error) => {
      this.bridgeClosed = true;
      this.setPhase("FAILED");
      this.protocol.rejectAllPending(error);
      this.protocol.notifySubscriptionsClosed(error);
    };
    this.removeRecoverySignals = observeRecoverySignals(() =>
      this.recoverIfNeeded(),
    );
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    document.addEventListener("visibilitychange", this.visibility);
  }

  private canRecover(): boolean {
    return (
      !this.disposed &&
      !this.bridgeClosed &&
      !this.authenticationRequired &&
      this.phase !== "SUSPENDED" &&
      this.phase !== "TERMINAL_FAILED"
    );
  }

  private recoverIfNeeded(networkRestored = false): void {
    if (
      !this.canRecover() ||
      document.hidden ||
      navigator.onLine === false ||
      !["FAILED", "EXHAUSTED", "OFFLINE"].includes(this.phase) ||
      (!networkRestored && Date.now() - this.lastRecovery < 1000)
    )
      return;
    void this.reconnect().catch(() => {});
  }

  private scheduleRecovery(): void {
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    if (
      !this.canRecover() ||
      document.hidden ||
      navigator.onLine === false ||
      !["FAILED", "EXHAUSTED"].includes(this.phase)
    )
      return;
    // Native owns its short retry cycle. After exhaustion, only visible demand
    // can request another cycle; no duplicate sockets or hidden polling.
    this.recoveryTimer = setTimeout(() => this.recoverIfNeeded(), 60_000);
  }

  private setPhase(phase: string): void {
    const state =
      phase === "CONNECTED"
        ? "ready"
        : phase === "CONNECTING" || phase === "IDLE"
          ? "connecting"
          : phase === "RETRYING" ||
              phase === "EXHAUSTED" ||
              (phase === "OFFLINE" && this.explicitRecovery)
            ? "reconnecting"
            : "disconnected";
    // Android's explicit recovery contract may arrive after the offline event.
    // Preserve unchanged snapshots, but do not keep a stale terminal mapping.
    if (phase === this.phase && state === this.snapshot.state) return;
    this.phase = phase;
    this.scheduleRecovery();
    const previous = this.snapshot.state;
    this.snapshot = {
      kind: "secure",
      state,
      channels: [
        {
          name: "secure-websocket",
          state: state === "ready" ? "connected" : state,
        },
      ],
    };
    if (previous === "ready" && state !== "ready") {
      const error = new ConnectionReconnectingError();
      this.protocol?.rejectAllPending(error);
      for (const upload of this.uploads.values()) upload.reject(error);
    }
    for (const listener of [...this.listeners]) listener();
    if (phase === "REAUTHENTICATION_REQUIRED" || phase === "REVOKED")
      this.onAuthenticationRequired();
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
    if (this.disposed) throw new SourceTransportDisposedError("secure");
    if (this.snapshot.state === "ready") return;
    this.recoverIfNeeded();
    if (this.snapshot.state === "disconnected")
      throw new SourceTransportDisconnectedError({ kind: "secure" });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        release();
        reject(new ConnectionReconnectingError());
      }, 15_000);
      const release = this.status.subscribe(() => {
        if (
          this.snapshot.state === "ready" ||
          this.snapshot.state === "disconnected"
        ) {
          clearTimeout(timeout);
          release();
          if (this.snapshot.state === "ready") resolve();
          else reject(new SourceTransportDisconnectedError({ kind: "secure" }));
        }
      });
    });
  }

  private send(message: RemoteClientMessage): void {
    if (this.disposed) throw new SourceTransportDisposedError("secure");
    switch (message.type) {
      case "request":
        void this.bridge
          .request<{
            status: number;
            headers: Record<string, string>;
            body: unknown;
          }>("request", message, undefined, message.id)
          .then(
            (result) =>
              this.protocol.routeMessage({
                type: "response",
                id: message.id,
                ...result,
              }),
            (error: Error) => {
              const pending = this.protocol.pendingRequests.get(message.id);
              if (pending) {
                if (
                  error instanceof NativeOperationError &&
                  error.code === "CONNECTION_UNAVAILABLE"
                ) {
                  // The operation reply can beat native's state notification.
                  // Admit the safe-read retry only after native is ready again.
                  // An abandoned request cannot regress a newer ready state.
                  if (this.phase === "CONNECTED" && this.canRecover()) {
                    this.setPhase("RETRYING");
                    return; // The ready-to-retrying transition rejected pending work.
                  }
                  error = new ConnectionReconnectingError();
                }
                clearTimeout(pending.timeout);
                this.protocol.pendingRequests.delete(message.id);
                pending.reject(error);
              }
            },
          );
        break;
      case "subscribe":
        // Only source operations cross the bridge; web browser metadata is not native identity.
        void this.bridge
          .request("subscribe", {
            subscriptionId: message.subscriptionId,
            channel: message.channel,
            ...("sessionId" in message ? { sessionId: message.sessionId } : {}),
            ...("projectId" in message ? { projectId: message.projectId } : {}),
            ...("provider" in message ? { provider: message.provider } : {}),
            ...("lastEventId" in message
              ? { lastEventId: message.lastEventId }
              : {}),
            ...("wantsLiveDeltas" in message
              ? { wantsLiveDeltas: message.wantsLiveDeltas }
              : {}),
            // Native bridges do not forward this yet; the web client still
            // drops live tool output itself.
            ...("wantsLiveToolOutput" in message
              ? { wantsLiveToolOutput: message.wantsLiveToolOutput }
              : {}),
            ...("coverage" in message ? { coverage: message.coverage } : {}),
          })
          .catch((error: Error) => {
            this.failSubscription(message.subscriptionId, error);
          });
        break;
      case "unsubscribe":
        void this.bridge
          .request("unsubscribe", { subscriptionId: message.subscriptionId })
          .catch(() => {});
        break;
      default:
        throw new Error("Unsupported native source operation");
    }
  }

  private failSubscription(id: string, error: Error): void {
    // Late setup errors cannot change a newer subscription or ready state.
    if (!this.protocol.subscriptions.has(id)) return;
    const unavailable =
      error instanceof NativeOperationError &&
      error.code === "CONNECTION_UNAVAILABLE";
    this.protocol.rejectSubscription(
      id,
      unavailable ? new ConnectionReconnectingError() : error,
    );
    if (unavailable && this.phase === "CONNECTED" && this.canRecover())
      this.setPhase("RETRYING");
  }

  fetch<T>(path: string, init?: RequestInit): Promise<T> {
    return this.protocol.fetch<T>(path, init);
  }
  fetchResponse(path: string, init?: RequestInit): Promise<Response> {
    return this.protocol.fetchResponse(path, init);
  }
  fetchBlob(path: string): Promise<Blob> {
    return this.protocol.fetchBlob(path);
  }
  subscribeSession(
    id: string,
    handlers: StreamHandlers,
    lastEventId?: string,
    options?: SessionSubscriptionOptions,
  ) {
    return this.protocol.subscribeSession(id, handlers, lastEventId, options);
  }
  subscribeSessionWatch(
    id: string,
    handlers: StreamHandlers,
    options?: SessionWatchSubscriptionOptions,
  ) {
    return this.protocol.subscribeSessionWatch(id, handlers, options);
  }
  subscribeActivity(handlers: StreamHandlers) {
    return this.protocol.subscribeActivity(handlers);
  }
  subscribeGlossary(id: string, handlers: StreamHandlers) {
    return this.protocol.subscribeGlossary(id, handlers);
  }
  subscribeWorktree(
    id: string,
    coverage: GitWorktreeCoverage,
    handlers: StreamHandlers,
  ) {
    return this.protocol.subscribeWorktree(id, coverage, handlers);
  }

  upload(
    projectId: string,
    sessionId: string,
    file: File,
    options?: UploadOptions,
  ): Promise<UploadedFile> {
    return this.runUpload(
      file,
      { type: "upload_start", projectId, sessionId },
      options,
    );
  }
  uploadStagedAttachment(
    file: File,
    options?: UploadOptions & { batchId?: string },
  ): Promise<StagedAttachmentRef> {
    return this.runUpload(
      file,
      { type: "staged_upload_start", batchId: options?.batchId },
      options,
    );
  }
  private async runUpload<T>(
    file: File,
    params: Record<string, unknown>,
    options?: UploadOptions,
  ): Promise<T> {
    if (options?.signal?.aborted)
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    if (file.size > 100 * 1024 * 1024)
      throw new Error("Native upload exceeds 100 MiB");
    await this.ensureReady();
    if (this.uploads.size >= 4) throw new Error("Native upload limit exceeded");
    const uploadId = generateUUID();
    let rejectUpload!: (error: Error) => void;
    const completion = new Promise<T>((resolve, reject) => {
      rejectUpload = reject;
      this.uploads.set(uploadId, {
        resolve: (value) => resolve(value as T),
        reject,
        onProgress: options?.onProgress,
      });
    });
    const operation = new AbortController();
    const failed = new Promise<never>((_, reject) => {
      void completion.catch((error: Error) => {
        operation.abort(error);
        reject(error);
      });
    });
    // Stop producing immediately on cancellation, timeout or connection loss.
    void failed.catch(() => {});
    const interruptible = <R>(work: Promise<R>): Promise<R> =>
      Promise.race([work, failed]);
    const abort = () =>
      rejectUpload(
        options?.signal?.reason ?? new DOMException("Aborted", "AbortError"),
      );
    options?.signal?.addEventListener("abort", abort, { once: true });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const timer = setTimeout(
      () => rejectUpload(new Error("Native upload timed out")),
      120_000,
    );
    try {
      if (options?.signal?.aborted)
        throw (
          options.signal.reason ?? new DOMException("Aborted", "AbortError")
        );
      await interruptible(
        this.bridge.request(
          "uploadStart",
          {
            ...params,
            uploadId,
            filename: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
            width: options?.imageDimensions?.width,
            height: options?.imageDimensions?.height,
          },
          operation.signal,
        ),
      );
      reader = file.stream().getReader();
      let offset = 0;
      while (true) {
        if (options?.signal?.aborted)
          throw (
            options.signal.reason ?? new DOMException("Aborted", "AbortError")
          );
        const { done, value } = await interruptible(reader.read());
        if (done) break;
        // Include the 24-byte upload header in one credited bridge frame.
        for (let start = 0; start < value.length; start += 65_512) {
          if (options?.signal?.aborted)
            throw (
              options.signal.reason ?? new DOMException("Aborted", "AbortError")
            );
          const chunk = value.subarray(
            start,
            Math.min(start + 65_512, value.length),
          );
          await interruptible(
            this.bridge.send(
              2,
              encodeUploadChunkPayload(uploadId, offset, chunk),
            ),
          );
          offset += chunk.length;
        }
      }
      await interruptible(
        this.bridge.request("uploadEnd", { uploadId }, operation.signal),
      );
      return await completion;
    } catch (error) {
      void this.bridge.request("uploadCancel", { uploadId }).catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener("abort", abort);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      this.uploads.delete(uploadId);
    }
  }
  reconnect(): Promise<void> {
    if (this.recovery) return this.recovery;
    if (!this.canRecover())
      return Promise.reject(
        new SourceTransportDisconnectedError({ kind: "secure" }),
      );
    this.lastRecovery = Date.now();
    this.setPhase("RETRYING");
    const recovery = this.bridge.request<void>("reconnect");
    this.recovery = recovery;
    void recovery
      .then(
        () => {
          if (this.canRecover() && this.phase === "RETRYING")
            this.setPhase("CONNECTED");
        },
        () => {
          if (this.canRecover() && this.phase !== "OFFLINE")
            this.setPhase(this.explicitRecovery ? "EXHAUSTED" : "FAILED");
        },
      )
      .finally(() => {
        if (this.recovery === recovery) this.recovery = null;
      });
    return recovery;
  }
  forceReconnect(): Promise<void> {
    return this.reconnect();
  }
  switchHost(): Promise<void> {
    return this.bridge.request("switchHost");
  }
  get authenticationRequired(): boolean {
    return (
      this.phase === "REAUTHENTICATION_REQUIRED" || this.phase === "REVOKED"
    );
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.recoveryTimer);
    this.removeRecoverySignals();
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("online", this.online);
    document.removeEventListener("visibilitychange", this.visibility);
    this.protocol.close();
    this.bridge.close();
    this.listeners.clear();
    for (const upload of this.uploads.values())
      upload.reject(new SourceTransportDisposedError("secure"));
    this.uploads.clear();
  }
}
