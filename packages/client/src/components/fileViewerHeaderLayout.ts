/** Window controls use spare title width without wrapping either text row. */
export function fileViewerWindowControlsFit({
  availableWidth,
  contextWidth,
  headerGap,
  filenameWidth,
  provenanceWidth,
  windowWidth,
}: {
  availableWidth: number;
  contextWidth: number;
  headerGap: number;
  filenameWidth: number;
  provenanceWidth: number;
  windowWidth: number;
}): boolean {
  return (
    windowWidth > 0 &&
    contextWidth +
      Math.max(filenameWidth, provenanceWidth) +
      windowWidth +
      headerGap * (contextWidth > 0 ? 2 : 1) <=
      availableWidth
  );
}
