import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  encodeNativeFrame,
  NativeFrameReceiver,
  NATIVE_MESSAGE_BYTES,
} from "../nativeTransportBridge";

describe("native transport frames", () => {
  it("reassembles 1 MiB and rejects replay, gaps and size changes", () => {
    const input = new Uint8Array(1024 * 1024).map((_, index) => index % 251);
    const receiver = new NativeFrameReceiver();
    let message: Uint8Array | undefined;
    for (let offset = 0; offset < input.length; offset += 65_536) {
      const result = receiver.accept(
        encodeNativeFrame(
          1,
          1,
          offset,
          input.length,
          input.subarray(offset, offset + 65_536),
        ),
      );
      message = result.message;
      expect(result.offset).toBe(offset + 65_536);
    }
    // Compare every byte in native code rather than building a million-node
    // deep-equality walk. CI run 36796881935 exceeded 5s in this assertion;
    // transport correctness, rather than the assertion engine's speed, matters.
    expect(message?.length).toBe(input.length);
    expect(Buffer.from(message!).equals(Buffer.from(input))).toBe(true);
    expect(() =>
      receiver.accept(encodeNativeFrame(1, 1, 0, 1, new Uint8Array([1]))),
    ).toThrow("sequence");
    const second = new NativeFrameReceiver();
    second.accept(encodeNativeFrame(1, 1, 0, 3, new Uint8Array([1])));
    expect(() =>
      second.accept(encodeNativeFrame(1, 1, 2, 3, new Uint8Array([2]))),
    ).toThrow("sequence");
    expect(() =>
      second.accept(encodeNativeFrame(1, 1, 1, 4, new Uint8Array([2]))),
    ).toThrow("Inconsistent");
  });

  it("rejects oversized frames before allocation", () => {
    expect(() =>
      encodeNativeFrame(1, 1, 0, NATIVE_MESSAGE_BYTES + 1, new Uint8Array([1])),
    ).toThrow();
    const frame = encodeNativeFrame(1, 1, 0, 1, new Uint8Array([1]));
    new DataView(frame).setUint32(12, NATIVE_MESSAGE_BYTES + 1);
    expect(() => new NativeFrameReceiver().accept(frame)).toThrow();
    expect(() =>
      new NativeFrameReceiver().accept(new ArrayBuffer(16)),
    ).toThrow();
  });
});
