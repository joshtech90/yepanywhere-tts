import {
  encodeNativeFrame,
  NativeFrameReceiver,
  type NativeTransportChannel,
} from "../../nativeTransportBridge";

export class NativeTransportFixture {
  readonly commands: Record<string, unknown>[] = [];
  readonly chunks: Uint8Array[] = [];
  readonly receiver = new NativeFrameReceiver();
  readonly channel: NativeTransportChannel;
  private nextId = 1;
  private tail = Promise.resolve();
  private credit: (() => void) | null = null;
  handler: (command: Record<string, unknown>) => unknown | Promise<unknown> = (
    command,
  ) => {
    if (command.method === "request")
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
      };
    return {};
  };

  constructor(
    readonly binary = true,
    readonly initialPhase = "CONNECTED",
  ) {
    this.channel = {
      onmessage: null,
      postMessage: (data) => this.receive(data),
    };
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data === "string" && data.startsWith("release:")) return;
    if (typeof data === "string" && data.startsWith("ack:")) {
      this.credit?.();
      this.credit = null;
      return;
    }
    if (typeof data === "string" && data.startsWith("{")) {
      queueMicrotask(() => {
        this.channel.onmessage?.({
          data: JSON.stringify({
            type: "hello",
            protocol: 1,
            handle: "document-one",
            profileId: "profile-one",
            label: "Test host",
            binary: this.binary,
          }),
        });
        void this.emit({ type: "state", phase: this.initialPhase });
      });
      return;
    }
    const frame =
      typeof data === "string"
        ? Uint8Array.from(atob(data.slice(6)), (char) => char.charCodeAt(0))
            .buffer
        : data;
    const result = this.receiver.accept(frame);
    queueMicrotask(() =>
      this.channel.onmessage?.({
        data: `ack:document-one:${result.id}:${result.offset}`,
      }),
    );
    if (!result.message) return;
    if (new DataView(frame).getUint8(3) === 2) {
      this.chunks.push(result.message);
      return;
    }
    const command = JSON.parse(
      new TextDecoder().decode(result.message),
    ) as Record<string, unknown>;
    this.commands.push(command);
    if (command.method === "cancel") return;
    void Promise.resolve()
      .then(() => this.handler(command))
      .then(
        (value) => this.emit({ type: "reply", id: command.id, result: value }),
        (error: Error) =>
          this.emit({ type: "reply", id: command.id, error: error.message }),
      );
  }

  emit(message: Record<string, unknown>): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(message));
    const task = this.tail.then(async () => {
      const id = this.nextId++;
      for (let offset = 0; offset < bytes.length; offset += 65_536) {
        const frame = encodeNativeFrame(
          1,
          id,
          offset,
          bytes.length,
          bytes.subarray(offset, offset + 65_536),
        );
        await new Promise<void>((resolve) => {
          this.credit = resolve;
          if (this.binary) this.channel.onmessage?.({ data: frame });
          else
            this.channel.onmessage?.({
              data: `frame:${btoa(String.fromCharCode(...new Uint8Array(frame)))}`,
            });
        });
      }
    });
    this.tail = task;
    return task;
  }
}
