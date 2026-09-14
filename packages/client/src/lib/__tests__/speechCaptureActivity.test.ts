// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetSpeechCaptureActivityForTests,
  setSpeechCaptureActivity,
} from "../speechCaptureActivity";
import {
  acquireSharedSpeechMicActiveLease,
  getSpeechMicStream,
  releaseSharedSpeechMicStream,
  stopSpeechStreamTracks,
} from "../speechProviders/sharedMicCapture";

describe("speechCaptureActivity", () => {
  afterEach(() => {
    releaseSharedSpeechMicStream();
    resetSpeechCaptureActivityForTests();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("keeps playback muted until the retained microphone actually closes", async () => {
    const media = document.createElement("audio");
    document.body.append(media);
    const track = {
      readyState: "live",
      stop: vi.fn(() => {
        track.readyState = "ended";
      }),
    };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    const lease = acquireSharedSpeechMicActiveLease();
    const composer = {};
    setSpeechCaptureActivity(composer, "starting");
    await getSpeechMicStream({ keepWarm: true, activeLease: lease });
    lease.release();
    setSpeechCaptureActivity(composer, null);

    expect(track.stop).not.toHaveBeenCalled();
    expect(media.muted).toBe(true);
    releaseSharedSpeechMicStream();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(media.muted).toBe(false);
  });

  it("restores playback when the browser ends its last microphone track", async () => {
    const media = document.createElement("audio");
    document.body.append(media);
    const track = {
      readyState: "live",
      onended: null as (() => void) | null,
      stop: vi.fn(),
    };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    await getSpeechMicStream({ keepWarm: false });
    expect(media.muted).toBe(true);
    track.readyState = "ended";
    track.onended?.();
    expect(media.muted).toBe(false);
    stopSpeechStreamTracks(stream);
  });

  it("mutes YA media during capture and restores each prior state", () => {
    const unmuted = document.createElement("audio");
    const alreadyMuted = document.createElement("video");
    alreadyMuted.muted = true;
    document.body.append(unmuted, alreadyMuted);
    const owner = {};

    setSpeechCaptureActivity(owner, "starting");

    expect(document.documentElement.dataset.speechCapture).toBe("starting");
    expect(unmuted.muted).toBe(true);
    expect(alreadyMuted.muted).toBe(true);

    setSpeechCaptureActivity(owner, "capturing");
    expect(document.documentElement.dataset.speechCapture).toBe("capturing");

    setSpeechCaptureActivity(owner, null);
    expect(document.documentElement.dataset.speechCapture).toBeUndefined();
    expect(unmuted.muted).toBe(false);
    expect(alreadyMuted.muted).toBe(true);
  });

  it("mutes media inserted after capture begins", async () => {
    const owner = {};
    setSpeechCaptureActivity(owner, "capturing");

    const added = document.createElement("video");
    document.body.append(added);
    await Promise.resolve();

    expect(added.muted).toBe(true);
    setSpeechCaptureActivity(owner, null);
    expect(added.muted).toBe(false);
  });

  it("does not restore media until every capture owner is idle", () => {
    const media = document.createElement("audio");
    document.body.append(media);
    const firstOwner = {};
    const secondOwner = {};

    setSpeechCaptureActivity(firstOwner, "starting");
    setSpeechCaptureActivity(secondOwner, "capturing");
    setSpeechCaptureActivity(secondOwner, null);

    expect(media.muted).toBe(true);
    expect(document.documentElement.dataset.speechCapture).toBe("starting");

    setSpeechCaptureActivity(firstOwner, null);
    expect(media.muted).toBe(false);
  });
});
