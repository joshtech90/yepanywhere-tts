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

  describe("Android audio focus hold", () => {
    const players: FakeAudio[] = [];
    class FakeAudio {
      loop = false;
      muted = false;
      paused = true;
      constructor(readonly src: string) {
        players.push(this);
      }
      play = vi.fn(async () => {
        this.paused = false;
      });
      pause = vi.fn(() => {
        this.paused = true;
      });
      removeAttribute = vi.fn();
      load = vi.fn();
    }
    const originalCreateObjectURL = URL.createObjectURL;

    afterEach(() => {
      players.length = 0;
      URL.createObjectURL = originalCreateObjectURL;
    });

    function stubPlatform(userAgent: string): void {
      vi.stubGlobal("navigator", { userAgent });
      vi.stubGlobal("Audio", FakeAudio);
      URL.createObjectURL = vi.fn(() => "blob:silence");
    }

    it("plays a short unmuted looping clip until every owner is idle", () => {
      stubPlatform("Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/140");
      const firstOwner = {};
      const secondOwner = {};

      setSpeechCaptureActivity(firstOwner, "starting");
      setSpeechCaptureActivity(secondOwner, "capturing");
      expect(players).toHaveLength(1);
      const [player] = players;
      expect(player?.play).toHaveBeenCalledTimes(1);
      expect(player?.loop).toBe(true);
      expect(player?.muted).toBe(false);

      setSpeechCaptureActivity(secondOwner, null);
      expect(player?.paused).toBe(false);

      setSpeechCaptureActivity(firstOwner, null);
      expect(player?.paused).toBe(true);
      expect(players).toHaveLength(1);
    });

    it("lets a retained microphone mute YA media without ducking other apps", () => {
      stubPlatform("Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/140");
      const media = document.createElement("audio");
      document.body.append(media);
      const retainedStream = {};
      const composer = {};

      setSpeechCaptureActivity(retainedStream, "capturing", {
        holdAudioFocus: false,
      });
      expect(media.muted).toBe(true);
      expect(players).toHaveLength(0);

      setSpeechCaptureActivity(composer, "capturing");
      expect(players[0]?.paused).toBe(false);
      setSpeechCaptureActivity(composer, null);
      expect(players[0]?.paused).toBe(true);
      expect(media.muted).toBe(true);
    });

    it("does not play anything off Android", () => {
      stubPlatform("Mozilla/5.0 (X11; Linux x86_64) Chrome/140");
      const owner = {};
      setSpeechCaptureActivity(owner, "capturing");
      setSpeechCaptureActivity(owner, null);
      expect(players).toHaveLength(0);
    });
  });
});
