function packedRowCount(
  itemWidths: readonly number[],
  availableWidth: number,
  gap: number,
): number {
  if (itemWidths.length === 0) return 0;
  if (availableWidth <= 0) return Number.POSITIVE_INFINITY;

  let rows = 1;
  let used = 0;
  for (const width of itemWidths) {
    const next = used === 0 ? width : used + gap + width;
    if (used > 0 && next > availableWidth) {
      rows += 1;
      used = width;
    } else {
      used = next;
    }
  }
  return rows;
}

export function shouldStackFileViewerActions({
  actionGap,
  actionWidths,
  availableWidth,
  contextWidth,
  headerGap,
  provenanceWidth,
}: {
  actionGap: number;
  actionWidths: readonly number[];
  availableWidth: number;
  contextWidth: number;
  headerGap: number;
  provenanceWidth: number;
}): boolean {
  if (actionWidths.length === 0) return false;

  const fixedWidths = [contextWidth, provenanceWidth].filter(
    (width) => width > 0,
  );
  const fixedWidth = fixedWidths.reduce((total, width) => total + width, 0);
  const sharedWidth =
    availableWidth - fixedWidth - headerGap * Math.max(0, fixedWidths.length);
  const sharedRows = packedRowCount(actionWidths, sharedWidth, actionGap);
  const stackedRows =
    1 + packedRowCount(actionWidths, availableWidth, actionGap);

  // A tie gets the cleaner soft break: actions share the context row only
  // when doing so removes a complete row from the header.
  return sharedRows >= stackedRows;
}
