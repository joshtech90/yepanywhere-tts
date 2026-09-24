import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  ttsPlan: vi.fn(),
  ttsSynthesize: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    ttsPlan: apiMocks.ttsPlan,
    ttsSynthesize: apiMocks.ttsSynthesize,
  },
}));

import {
  getReadAloudState,
  getReadAloudToken,
  playReadAloud,
  stopReadAloud,
} from "./readAloud";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return {
    promise,
    resolve(value) {
      if (!resolve) throw new Error("deferred promise is not initialized");
      resolve(value);
    },
  };
}

class MockAudio {
  static instances: MockAudio[] = [];

  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  pause = vi.fn();
  play = vi.fn(async () => {});

  constructor() {
    MockAudio.instances.push(this);
  }
}

class MockURL extends URL {
  static createObjectURL = vi.fn(
    () => `blob:audio-${MockAudio.instances.length}`,
  );
  static revokeObjectURL = vi.fn();
}

beforeEach(() => {
  stopReadAloud();
  apiMocks.ttsPlan.mockReset();
  apiMocks.ttsSynthesize.mockReset();
  MockAudio.instances = [];
  MockURL.createObjectURL.mockClear();
  MockURL.revokeObjectURL.mockClear();
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("URL", MockURL);
});

afterEach(() => {
  stopReadAloud();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("read-aloud controller", () => {
  it("plans once, prefetches the next chunk, and plays chunks in order", async () => {
    const first = deferred<{ audioBase64: string; mimeType?: string }>();
    const second = deferred<{ audioBase64: string; mimeType?: string }>();
    apiMocks.ttsPlan.mockResolvedValue({ chunks: ["First", "Second"] });
    apiMocks.ttsSynthesize
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const playback = playReadAloud("A long response", "cockpit-response-1");
    await vi.waitFor(() => {
      expect(apiMocks.ttsSynthesize).toHaveBeenCalledTimes(2);
    });
    expect(apiMocks.ttsSynthesize.mock.calls).toEqual([
      ["First", true],
      ["Second", true],
    ]);
    expect(getReadAloudState()).toBe("loading");
    expect(getReadAloudToken()).toBe("cockpit-response-1");

    first.resolve({ audioBase64: "AA==", mimeType: "audio/mpeg" });
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    expect(getReadAloudState()).toBe("playing");
    MockAudio.instances[0]?.onended?.();

    second.resolve({ audioBase64: "AQ==", mimeType: "audio/mpeg" });
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
    MockAudio.instances[0]?.onended?.();
    await playback;

    expect(getReadAloudState()).toBe("idle");
    expect(getReadAloudToken()).toBeNull();
  });

  it("stops the current app-wide playback and settles its pending controller", async () => {
    apiMocks.ttsPlan.mockResolvedValue({ chunks: ["Only chunk"] });
    apiMocks.ttsSynthesize.mockResolvedValue({
      audioBase64: "AA==",
      mimeType: "audio/mpeg",
    });

    const playback = playReadAloud("Stop this response", "cockpit-response-2");
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    const audio = MockAudio.instances[0];
    expect(audio).toBeTruthy();

    stopReadAloud();
    await playback;

    expect(audio?.pause).toHaveBeenCalledTimes(1);
    expect(getReadAloudState()).toBe("idle");
    expect(getReadAloudToken()).toBeNull();
  });
});
