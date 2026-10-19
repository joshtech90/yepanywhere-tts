/** Adapter-owned image preparation policy for browser and filesystem uploads. */
export function getProviderImageSizing(providerName, model) {
  const claude =
    providerName === "claude" || /(?:^|[/:])claude-/.test(model ?? "");
  const version = model?.match(
    /(?:claude-)?(?:opus|sonnet|haiku)-(\d+)[.-](\d+)/,
  );
  const highResolutionClaude =
    claude &&
    version &&
    (Number(version[1]) > 4 ||
      (Number(version[1]) === 4 && Number(version[2]) >= 7));
  const maxLongEdge = claude
    ? highResolutionClaude
      ? 2576
      : 1568
    : providerName === "codex" || providerName === "codex-oss"
      ? 2048
      : 2000;
  // Leave room for base64 on Claude routes with a 5 MB encoded-image limit.
  const maxBytes = (claude ? 3 : 4) * 1024 * 1024;
  const sd = {
    maxLongEdge: Math.min(2000, maxLongEdge),
    maxBytes,
    quality: 90,
  };
  const hd = { maxLongEdge, maxBytes, quality: 95 };
  return {
    defaultLongEdgePx: sd.maxLongEdge,
    maxUsefulLongEdgePx: hd.maxLongEdge,
    profiles: { sd, hd },
  };
}
