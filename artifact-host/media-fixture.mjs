import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile, readFile, open } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chart } from "../research/content-worker-localhost-spike/fixture.mjs";

const PREFIX = 96 * 1024 * 1024;
const BLOCK = 65536;
async function hashFile(path, prefix = false) {
  const digest = createHash("sha256");
  const buffer = Buffer.alloc(BLOCK);
  let fill = 0;
  for await (const chunk of createReadStream(path, {
    highWaterMark: BLOCK,
    ...(prefix ? { end: PREFIX - 1 } : {}),
  })) {
    if (!prefix) {
      digest.update(chunk);
      continue;
    }
    let offset = 0;
    while (offset < chunk.length) {
      const count = Math.min(BLOCK - fill, chunk.length - offset);
      chunk.copy(buffer, fill, offset, offset + count);
      offset += count;
      fill += count;
      if (fill === BLOCK) {
        digest.update(createHash("sha256").update(buffer).digest());
        fill = 0;
      }
    }
  }
  if (fill)
    digest.update(
      createHash("sha256").update(buffer.subarray(0, fill)).digest(),
    );
  return digest.digest("hex");
}

/** Real H.264 frames and valid CBR filler, not a padded non-movie file. */
export async function createLargeMediaFixture(project) {
  const directory = join(project, "media");
  await mkdir(directory, { recursive: true });
  const images = [];
  for (let i = 0; i < 20; i++) {
    const bytes = chart(i + 1);
    const path = `media/chart-${i}.png`;
    await writeFile(join(project, path), bytes);
    images.push({
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const movie = join(directory, "movie.mp4");
  await new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=12",
        "-t",
        "600",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-profile:v",
        "baseline",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "24",
        "-bf",
        "0",
        "-b:v",
        "2M",
        "-minrate",
        "2M",
        "-maxrate",
        "2M",
        "-bufsize",
        "4M",
        "-x264-params",
        "nal-hrd=cbr:force-cfr=1",
        "-an",
        "-movflags",
        "+faststart",
        movie,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let errors = "";
    child.stderr.on("data", (data) => {
      errors = (errors + data).slice(-4000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error(`Movie fixture failed: ${errors}`));
    });
  });
  const size = (await stat(movie)).size;
  if (size < 128 * 1024 * 1024 || size > 256 * 1024 * 1024)
    throw new Error(
      "Movie must cross the former file limit within the new bound",
    );
  const markup = `<section id="media-fixture"><h2>Twenty local images</h2><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${images.map((image, i) => `<figure style="margin:0"><img data-media-image src="${image.path}" alt="Local chart ${i + 1}"><figcaption>Chart ${i + 1}</figcaption></figure>`).join("")}</div><h2>Large local movie</h2><button id="play-local-movie" onclick="document.querySelector('#local-movie').play()">Play local movie</button><video id="local-movie" controls muted playsinline preload="metadata" style="width:100%" src="media/movie.mp4"></video></section>`;
  const index = join(project, "index.html");
  await writeFile(
    index,
    (await readFile(index, "utf8")).replace("</main>", `${markup}</main>`),
  );
  const handle = await open(movie, "r");
  const ranges = [];
  try {
    for (const [start, count, range] of [
      [50_000_000, 65536, "bytes=50000000-50065535"],
      [size - 8191, 8191, "bytes=-8191"],
      [
        size - 2 * 1024 * 1024,
        2 * 1024 * 1024,
        `bytes=${size - 2 * 1024 * 1024}-`,
      ],
    ]) {
      const bytes = Buffer.alloc(count);
      const result = await handle.read(bytes, 0, count, start);
      if (result.bytesRead !== count)
        throw new Error("Fixture range is incomplete");
      ranges.push({
        range,
        start,
        count,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  } finally {
    await handle.close();
  }
  return {
    size,
    ranges,
    sha256: await hashFile(movie),
    prefixBytes: PREFIX,
    prefixRoot: await hashFile(movie, true),
    images,
  };
}

export async function qualifyLargeMedia(frame, expected) {
  const resource = await frame.evaluate(
    async ({ expected, block }) => {
      const hex = (value) =>
        [...new Uint8Array(value)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      const digest = async (bytes) =>
        hex(await crypto.subtle.digest("SHA-256", bytes));
      const images = await Promise.all(
        expected.images.map(async (image) => {
          const node = [
            ...document.querySelectorAll("[data-media-image]"),
          ].find((node) => node.getAttribute("src") === image.path);
          await node.decode();
          const response = await fetch(image.path);
          const hash = await digest(await response.arrayBuffer());
          if (hash !== image.sha256 || node.naturalWidth !== 640)
            throw new Error("Local image bytes/dimensions changed");
          return { path: image.path, sha256: hash, width: node.naturalWidth };
        }),
      );
      const prefixStarted = performance.now();
      const response = await fetch("media/movie.mp4", {
        headers: { Range: "bytes=0-" },
      });
      if (
        response.status !== 206 ||
        response.headers.get("content-range") !==
          `bytes 0-${expected.size - 1}/${expected.size}`
      )
        throw new Error("Open-ended movie range metadata changed");
      const reader = response.body.getReader();
      let bytes = 0,
        fill = 0;
      const buffer = new Uint8Array(block);
      const hashes = [];
      while (bytes < expected.prefixBytes) {
        const part = await reader.read();
        if (part.done) throw new Error("Movie ended before the checked prefix");
        let offset = 0;
        while (offset < part.value.length && bytes < expected.prefixBytes) {
          const size = Math.min(
            block - fill,
            part.value.length - offset,
            expected.prefixBytes - bytes,
          );
          buffer.set(part.value.subarray(offset, offset + size), fill);
          offset += size;
          bytes += size;
          fill += size;
          if (fill === block) {
            hashes.push(
              new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
            );
            fill = 0;
          }
        }
      }
      await reader.cancel();
      const all = new Uint8Array(hashes.length * 32);
      hashes.forEach((hash, i) => {
        all.set(hash, i * 32);
      });
      const prefixRoot = await digest(all);
      if (prefixRoot !== expected.prefixRoot)
        throw new Error("Movie prefix bytes changed");
      const prefixTransferMs = performance.now() - prefixStarted;
      const ranges = [];
      for (const item of expected.ranges) {
        const response = await fetch("media/movie.mp4", {
          headers: { Range: item.range },
        });
        const hash = await digest(await response.arrayBuffer());
        if (
          response.status !== 206 ||
          hash !== item.sha256 ||
          response.headers.get("content-range") !==
            `bytes ${item.start}-${item.start + item.count - 1}/${expected.size}`
        )
          throw new Error("Movie range bytes/headers changed");
        ranges.push({ range: item.range, sha256: hash });
      }
      const invalid = await fetch("media/movie.mp4?invalid-range=1", {
        headers: { Range: `bytes=${expected.size + 1}-` },
      });
      if (
        invalid.status !== 416 ||
        invalid.headers.get("content-range") !== `bytes */${expected.size}`
      )
        throw new Error("Invalid movie range lost its refusal metadata");
      return {
        images,
        ranges,
        invalidRangeStatus: invalid.status,
        prefixBytes: bytes,
        prefixTransferMs,
        prefixRoot,
        movieSize: expected.size,
      };
    },
    { expected, block: BLOCK },
  );
  await frame.locator("#play-local-movie").click();
  await frame.locator("#local-movie").scrollIntoViewIfNeeded();
  const playback = await frame.evaluate(async () => {
    const video = document.querySelector("#local-movie");
    video.muted = true;
    await video.play();
    const until = async (predicate) => {
      const started = performance.now();
      while (!predicate()) {
        if (video.error) throw new Error(`Movie error ${video.error.code}`);
        if (performance.now() - started > 30_000)
          throw new Error("Movie playback/seek did not progress");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    await until(() => video.currentTime > 0.2);
    const positions = [];
    for (const fraction of [0.25, 0.75, 0.1, 0.99]) {
      const target = Math.min(video.duration - 5, video.duration * fraction);
      video.currentTime = target;
      await until(() => !video.seeking && video.currentTime >= target + 0.15);
      positions.push(video.currentTime);
    }
    video.pause();
    return { duration: video.duration, positions };
  });
  const pauseMs = 65_000;
  const [, pausedImages] = await Promise.all([
    new Promise((resolve) => setTimeout(resolve, pauseMs)),
    frame.evaluate(async (images) => {
      const video = document.querySelector("#local-movie");
      if (!video.paused) throw new Error("Movie did not remain paused");
      return await Promise.all(
        images.map(async (image) => {
          const response = await fetch(`${image.path}?while-movie-paused=1`, {
            signal: AbortSignal.timeout(30_000),
          });
          const hash = [
            ...new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                await response.arrayBuffer(),
              ),
            ),
          ]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          if (response.status !== 200 || hash !== image.sha256 || !video.paused)
            throw new Error(
              "Paused movie blocked or changed a sibling image read",
            );
          return { path: image.path, status: response.status, sha256: hash };
        }),
      );
    }, expected.images),
  ]);
  await frame.evaluate(() => {
    document.querySelector("#local-movie").currentTime = 300;
  });
  await frame.locator("#play-local-movie").click();
  await frame.locator("#local-movie").scrollIntoViewIfNeeded();
  const resumed = await frame.evaluate(async () => {
    const video = document.querySelector("#local-movie");
    const start = performance.now();
    while (video.currentTime < 300.2 || video.seeking || video.paused) {
      if (video.error || performance.now() - start > 30_000)
        throw new Error("Paused movie did not resume");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const frame = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("No video frame was presented")),
        5000,
      );
      video.requestVideoFrameCallback((_now, metadata) => {
        clearTimeout(timer);
        resolve({
          mediaTime: metadata.mediaTime,
          presentedFrames: metadata.presentedFrames,
        });
      });
    });
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 18;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, 32, 18);
    const data = context.getImageData(0, 0, 32, 18).data;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4)
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    if (
      video.videoWidth !== 640 ||
      video.videoHeight !== 360 ||
      colors.size < 8
    )
      throw new Error("Decoded movie pixels are missing");
    return {
      time: video.currentTime,
      playing: !video.paused,
      frame,
      decodedColors: colors.size,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  });
  return { ...resource, ...playback, pauseMs, pausedImages, resumed };
}
