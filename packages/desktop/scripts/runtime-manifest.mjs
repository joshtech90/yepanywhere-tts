export function selectBundledYaVersion(gitDescribe, packageVersion) {
  const described = gitDescribe?.trim();
  if (described && described !== "unknown") {
    return described;
  }

  const fallback = packageVersion?.trim();
  return fallback || "unknown";
}

/**
 * The version a packaged server reports for a manifest's `yepVersion`. The
 * server (`readDesktopBuildVersion`) accepts only a release-shaped version
 * and reports anything else as `unknown`, so a build from a checkout without
 * release tags, whose description is a bare commit, reports `unknown`.
 */
export function reportedYaVersion(yepVersion) {
  const version = yepVersion?.trim().replace(/^v(?=\d)/, "");
  return version && /^\d+\.\d+\.\d+(?:$|[-+])/.test(version)
    ? version
    : "unknown";
}
