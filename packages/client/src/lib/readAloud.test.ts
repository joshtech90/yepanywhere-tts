import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  ttsPlan: vi.fn(),
  ttsSynthesize: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    ttsPlan: apiMocks.ttsPlan,
    // Keep the API promise distinct from Vitest's auto-observed mock result.
    ttsSynthesize: async (...args: unknown[]) =>
      apiMocks.ttsSynthesize(...args),
  },
}));

import {
  getReadAloudFailedToken,
  getReadAloudState,
  getReadAloudToken,
  pauseReadAloud,
  playReadAloud,
  resumeReadAloud,
  stopReadAloud,
} from "./readAloud";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return {
    promise,
    reject(reason) {
      if (!reject) throw new Error("deferred promise is not initialized");
      reject(reason);
    },
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
  onpause: (() => void) | null = null;
  onplay: (() => void) | null = null;
  src = "";
  ended = false;
  paused = true;
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
    await vi.waitFor(() =>
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1),
    );
    expect(getReadAloudState()).toBe("playing");
    MockAudio.instances[0]?.onended?.();

    second.resolve({ audioBase64: "AQ==", mimeType: "audio/mpeg" });
    await vi.waitFor(() =>
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2),
    );
    MockAudio.instances[0]?.onended?.();
    await playback;

    expect(getReadAloudState()).toBe("idle");
    expect(getReadAloudToken()).toBeNull();
    expect(getReadAloudFailedToken()).toBeNull();
  });

  it("handles a failed prefetch while the current chunk is still playing", async () => {
    const second = deferred<{ audioBase64: string }>();
    const failure = new Error("prefetch offline");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    apiMocks.ttsPlan.mockResolvedValue({ chunks: ["First", "Second"] });
    apiMocks.ttsSynthesize
      .mockResolvedValueOnce({ audioBase64: "AA==" })
      .mockReturnValueOnce(second.promise);

    const playback = playReadAloud("Answer", "prefetch-failure");
    await vi.waitFor(() => expect(getReadAloudState()).toBe("playing"));
    second.reject(failure);
    // Cross a task boundary: a late catch after ended would already have
    // emitted an unhandled rejection in the browser (and fail Vitest).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getReadAloudState()).toBe("playing");
    expect(consoleError).not.toHaveBeenCalled();

    MockAudio.instances[0]?.onended?.();
    await playback;
    expect(getReadAloudState()).toBe("idle");
    expect(getReadAloudFailedToken()).toBe("prefetch-failure");
    expect(consoleError).toHaveBeenCalledWith("Read aloud failed:", failure);
  });

  it("pauses and resumes in place, and holds a chunk that lands while paused", async () => {
    const second = deferred<{ audioBase64: string; mimeType?: string }>();
    apiMocks.ttsPlan.mockResolvedValue({ chunks: ["First", "Second"] });
    apiMocks.ttsSynthesize
      .mockResolvedValueOnce({ audioBase64: "AA==", mimeType: "audio/mpeg" })
      .mockReturnValueOnce(second.promise);

    const playback = playReadAloud("A long response", "cockpit-response-3");
    await vi.waitFor(() => expect(getReadAloudState()).toBe("playing"));
    const audio = MockAudio.instances[0];
    if (!audio) throw new Error("no audio element");
    expect(audio.play).toHaveBeenCalledTimes(1);

    pauseReadAloud();
    expect(getReadAloudState()).toBe("paused");
    expect(getReadAloudToken()).toBe("cockpit-response-3");
    expect(audio.pause).toHaveBeenCalledTimes(1);

    resumeReadAloud();
    expect(getReadAloudState()).toBe("playing");
    expect(audio.play).toHaveBeenCalledTimes(2);

    // First chunk ends, pause while the second is still loading.
    audio.ended = true;
    audio.onended?.();
    pauseReadAloud();
    second.resolve({ audioBase64: "AQ==", mimeType: "audio/mpeg" });
    await vi.waitFor(() =>
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2),
    );
    expect(getReadAloudState()).toBe("paused");
    expect(audio.play).toHaveBeenCalledTimes(2);

    audio.ended = false;
    resumeReadAloud();
    expect(getReadAloudState()).toBe("playing");
    expect(audio.play).toHaveBeenCalledTimes(3);
    audio.onended?.();
    await playback;
    expect(getReadAloudState()).toBe("idle");
  });

  it("follows a pause and resume from outside the app, such as the lock screen", async () => {
    apiMocks.ttsPlan.mockResolvedValue({ chunks: ["Only"] });
    apiMocks.ttsSynthesize.mockResolvedValueOnce({ audioBase64: "AA==" });

    const playback = playReadAloud("Answer", "external-controls");
    await vi.waitFor(() => expect(getReadAloudState()).toBe("playing"));
    const audio = MockAudio.instances[0];
    if (!audio) throw new Error("no audio element");
    audio.paused = false;

    // A phone call or the lock screen pauses the element directly.
    audio.paused = true;
    audio.onpause?.();
    expect(getReadAloudState()).toBe("paused");
    expect(getReadAloudToken()).toBe("external-controls");

    // One tap on the answer's control continues it.
    resumeReadAloud();
    expect(getReadAloudState()).toBe("playing");
    expect(audio.play).toHaveBeenCalledTimes(2);

    // The lock screen can also continue a paused playback.
    pauseReadAloud();
    audio.paused = true;
    audio.onpause?.();
    expect(getReadAloudState()).toBe("paused");
    audio.paused = false;
    audio.onplay?.();
    expect(getReadAloudState()).toBe("playing");

    // A late pause event from an earlier pause after a fast resume, and the
    // pause that precedes "ended", leave the state alone.
    audio.onpause?.();
    expect(getReadAloudState()).toBe("playing");
    audio.paused = true;
    audio.ended = true;
    audio.onpause?.();
    expect(getReadAloudState()).toBe("playing");
    audio.onended?.();
    await playback;
    expect(getReadAloudState()).toBe("idle");
  });

  it("does not replay an ended chunk when resumed between chunks", async () => {
    const second = deferred<{ audioBase64: string; mimeType?: string }>();
    apiMocks.ttsPlan.mockResolvedValue({ chunks: ["First", "Second"] });
    apiMocks.ttsSynthesize
      .mockResolvedValueOnce({ audioBase64: "AA==", mimeType: "audio/mpeg" })
      .mockReturnValueOnce(second.promise);

    const playback = playReadAloud("A long response", "cockpit-response-4");
    await vi.waitFor(() => expect(getReadAloudState()).toBe("playing"));
    const audio = MockAudio.instances[0];
    if (!audio) throw new Error("no audio element");
    audio.ended = true;
    audio.onended?.();
    pauseReadAloud();
    resumeReadAloud();
    expect(getReadAloudState()).toBe("loading");
    expect(audio.play).toHaveBeenCalledTimes(1);

    audio.ended = false;
    second.resolve({ audioBase64: "AQ==", mimeType: "audio/mpeg" });
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    expect(getReadAloudState()).toBe("playing");
    audio.onended?.();
    await playback;
  });

  it("keeps the position when a pause aborts a starting play", async () => {
    let rejectPlay: ((error: unknown) => void) | undefined;
    apiMocks.ttsPlan.mockResolvedValue({ chunks: ["Only chunk"] });
    apiMocks.ttsSynthesize.mockResolvedValue({
      audioBase64: "AA==",
      mimeType: "audio/mpeg",
    });
    const playback = playReadAloud("Answer", "cockpit-response-5");
    MockAudio.instances[0]?.play.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectPlay = reject;
        }),
    );
    await vi.waitFor(() => expect(rejectPlay).toBeTruthy());
    pauseReadAloud();
    rejectPlay?.(new DOMException("interrupted by pause", "AbortError"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getReadAloudState()).toBe("paused");
    expect(getReadAloudToken()).toBe("cockpit-response-5");
    expect(getReadAloudFailedToken()).toBeNull();
    stopReadAloud();
    await playback;
  });

  it.each(["initial", "resume"])(
    "ignores an interrupted %s play after a newer resume succeeds",
    async (attempt) => {
      const interrupted = deferred<void>();
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      apiMocks.ttsPlan.mockResolvedValue({ chunks: ["Answer"] });
      apiMocks.ttsSynthesize.mockResolvedValue({ audioBase64: "AA==" });
      const playback = playReadAloud("Answer", "rapid-resume");
      const audio = MockAudio.instances[0];
      if (!audio) throw new Error("no audio element");
      if (attempt === "initial") {
        audio.play.mockReturnValueOnce(interrupted.promise);
      } else {
        await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
        pauseReadAloud();
        audio.play.mockReturnValueOnce(interrupted.promise);
        resumeReadAloud();
      }
      await vi.waitFor(() => expect(getReadAloudState()).toBe("playing"));
      pauseReadAloud();
      resumeReadAloud();
      interrupted.reject(
        new DOMException("interrupted by pause", "AbortError"),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getReadAloudState()).toBe("playing");
      expect(getReadAloudFailedToken()).toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
      stopReadAloud();
      await playback;
    },
  );

  it("ignores a late resume failure of an earlier playback", async () => {
    const rejects: Array<(error: unknown) => void> = [];
    apiMocks.ttsPlan.mockResolvedValue({ chunks: ["Only chunk"] });
    apiMocks.ttsSynthesize.mockResolvedValue({
      audioBase64: "AA==",
      mimeType: "audio/mpeg",
    });

    const first = playReadAloud("One", "answer-a");
    await vi.waitFor(() => expect(getReadAloudState()).toBe("playing"));
    const audioA = MockAudio.instances[0];
    if (!audioA) throw new Error("no audio element");
    pauseReadAloud();
    audioA.play.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejects.push(reject);
        }),
    );
    resumeReadAloud();

    const second = playReadAloud("Two", "answer-b");
    await vi.waitFor(() => expect(getReadAloudState()).toBe("playing"));
    rejects[0]?.(new DOMException("old resume aborted", "AbortError"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getReadAloudToken()).toBe("answer-b");
    expect(getReadAloudState()).toBe("playing");
    stopReadAloud();
    await Promise.all([first, second]);
  });

  it("stops the current app-wide playback and settles its pending controller", async () => {
    apiMocks.ttsPlan.mockResolvedValue({ chunks: ["Only chunk"] });
    apiMocks.ttsSynthesize.mockResolvedValue({
      audioBase64: "AA==",
      mimeType: "audio/mpeg",
    });

    const playback = playReadAloud("Stop this response", "cockpit-response-2");
    await vi.waitFor(() =>
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1),
    );
    const audio = MockAudio.instances[0];
    expect(audio).toBeTruthy();

    stopReadAloud();
    await playback;

    expect(audio?.pause).toHaveBeenCalledTimes(1);
    expect(getReadAloudState()).toBe("idle");
    expect(getReadAloudToken()).toBeNull();
    expect(getReadAloudFailedToken()).toBeNull();
  });

  it.each(["plan", "synthesis"])(
    "settles a stopped controller while %s is still pending",
    async (stage) => {
      const plan = deferred<{ chunks: string[] }>();
      const synthesis = deferred<{ audioBase64: string }>();
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      apiMocks.ttsPlan.mockReturnValue(plan.promise);
      apiMocks.ttsSynthesize.mockReturnValue(synthesis.promise);
      let settled = false;
      const playback = playReadAloud("Answer", "cancel-network").then(() => {
        settled = true;
      });
      if (stage === "synthesis") {
        plan.resolve({ chunks: ["Answer"] });
        await vi.waitFor(() =>
          expect(apiMocks.ttsSynthesize).toHaveBeenCalled(),
        );
      }
      stopReadAloud();
      await vi.waitFor(() => expect(settled).toBe(true));
      expect(getReadAloudState()).toBe("idle");
      if (stage === "plan") plan.reject(new Error("late plan failure"));
      else synthesis.reject(new Error("late synthesis failure"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(consoleError).not.toHaveBeenCalled();
      expect(MockURL.createObjectURL).not.toHaveBeenCalled();
      await playback;
    },
  );

  it("publishes a caller-scoped failure that explicit stop clears", async () => {
    const failure = new Error("TTS unavailable");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    apiMocks.ttsPlan.mockRejectedValue(failure);

    await playReadAloud("Retry this response", "cockpit-response-3");

    expect(consoleError).toHaveBeenCalledWith("Read aloud failed:", failure);
    expect(getReadAloudState()).toBe("idle");
    expect(getReadAloudToken()).toBeNull();
    expect(getReadAloudFailedToken()).toBe("cockpit-response-3");

    stopReadAloud();
    expect(getReadAloudFailedToken()).toBeNull();
  });
});
