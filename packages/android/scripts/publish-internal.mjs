// Only publishes the bundled YA app to an existing internal testing track.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const application = "applications/com.yepanywhere.mobile";
const api = "https://androidpublisher.googleapis.com";

export async function publishInternal({
  token,
  bundle,
  versionCode,
  sourceCommit,
  request = fetch,
}) {
  if (!token) throw new Error("PLAY_ACCESS_TOKEN is required");
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode <= 1002 ||
    versionCode > 2100000000
  ) {
    throw new Error("Invalid CI version code");
  }
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw new Error("Invalid source commit");
  const sha256 = createHash("sha256").update(bundle).digest("hex");
  const releaseName = `ci ${sourceCommit}`;
  async function call(method, path, body, upload = false) {
    const response = await request(
      `${api}${upload ? "/upload" : ""}/androidpublisher/v3/${application}/edits${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": upload
            ? "application/octet-stream"
            : "application/json",
        },
        body:
          body === undefined ? undefined : upload ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(upload ? 180000 : 30000),
      },
    );
    if (!response.ok) {
      // Do not dump headers, credentials or arbitrary server response content.
      throw new Error(`Play API ${method} ${path}: HTTP ${response.status}`);
    }
    return response.status === 204 ? undefined : response.json();
  }
  const edit = await call("POST", "", {});
  const editPath = `/${encodeURIComponent(edit.id)}`;
  let committed = false;
  try {
    const { tracks = [] } = await call("GET", `${editPath}/tracks`);
    // Google documentation calls this qa; existing API accounts may use internal.
    // Never accept a caller-selected arbitrary or production track.
    const internalTracks = tracks.filter(
      ({ track }) => track === "internal" || track === "qa",
    );
    if (internalTracks.length !== 1)
      throw new Error("Expected exactly one existing internal track");
    const current = internalTracks[0];
    const releases = current.releases ?? [];
    if (
      releases.some(
        (release) =>
          release.name === releaseName && release.status === "completed",
      )
    ) {
      return { status: "unchanged", sourceCommit, track: current.track };
    }
    const latest = Math.max(
      0,
      ...releases.flatMap((release) =>
        (release.versionCodes ?? []).map(Number),
      ),
    );
    if (versionCode <= latest)
      throw new Error("Refusing to replace a newer internal release");
    // Reuse an uploaded bundle only if its exact signed bytes match.
    const { bundles = [] } = await call("GET", `${editPath}/bundles`);
    let uploaded = bundles.find((entry) => entry.versionCode === versionCode);
    if (!uploaded)
      uploaded = await call(
        "POST",
        `${editPath}/bundles?uploadType=media`,
        bundle,
        true,
      );
    if (uploaded.versionCode !== versionCode || uploaded.sha256 !== sha256) {
      throw new Error(
        "Play bundle version or SHA-256 differs from the signed candidate",
      );
    }
    await call("PUT", `${editPath}/tracks/${current.track}`, {
      track: current.track,
      releases: [
        {
          name: releaseName,
          versionCodes: [String(versionCode)],
          status: "completed",
          releaseNotes: [
            {
              language: "en-US",
              text: `Latest tested Android build. Source: ${sourceCommit}`,
            },
          ],
        },
      ],
    });
    // Deliberately no draft fallback: a draft is not an installable test release.
    await call("POST", `${editPath}:validate`, {});
    await call("POST", `${editPath}:commit`, {});
    committed = true;
    return {
      status: "published",
      sourceCommit,
      versionCode,
      sha256,
      track: current.track,
    };
  } finally {
    if (!committed) await call("DELETE", editPath);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [bundlePath, receiptPath] = process.argv.slice(2);
  if (!bundlePath || !receiptPath)
    throw new Error("Usage: publish-internal.mjs signed.aab receipt.json");
  const receipt = await publishInternal({
    token: process.env.PLAY_ACCESS_TOKEN,
    bundle: await readFile(bundlePath),
    versionCode: Number(process.env.ORG_GRADLE_PROJECT_yaVersionCode),
    sourceCommit: process.env.GITHUB_SHA,
  });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
}
