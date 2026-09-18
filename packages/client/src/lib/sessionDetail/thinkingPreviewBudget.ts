/**
 * Vertical budget for a superseded ("previous") thinking preview that wrapped
 * below the current one.
 *
 * Beside the current card the previous one is free: it caps to the current
 * card's rendered height, which already owns the row. Wrapped below it, its
 * height *adds* to the row, and because the current card comes first it is the
 * one that leaves the top of the transcript viewport under follow — the reader
 * loses the thought they were reading in order to keep a superseded one. So a
 * wrapped previous card gets only the room left once the row still fits the
 * viewport with the tail of the preceding paragraph showing, and it is dropped
 * when even a short thought does not fit that.
 */

/**
 * Lines of the preceding paragraph kept visible above the activity row. Two
 * lines is the cheap stand-in for "the reader can still see where they were".
 */
export const CONVERSATION_CONTEXT_RESERVE_LINES = 2;

/**
 * Fallback mirror of `--output-prose-line-height` (`calc(1.5em + offset)`),
 * used only when the row renders no prose of its own to measure.
 */
export const CONVERSATION_PROSE_LINE_HEIGHT_RATIO = 1.5;

export interface StackedThinkingBudgetInput {
  /** Height of the scrolling transcript viewport the row has to fit inside. */
  viewportHeightPx: number;
  /**
   * Scroll content that follows the row — later rows, and the transcript's own
   * bottom padding and fade. At the live edge this sits below the row inside
   * the viewport, so the row cannot use it. Unaffected by the row's own height,
   * which is what keeps the decision from depending on its own outcome.
   */
  trailingContentPx: number;
  /** Space kept above the row for the tail of the preceding paragraph. */
  contextReservePx: number;
  /** Top of the previous card, measured from the row's top. */
  previousTopPx: number;
  /**
   * Everything of the previous card outside its content box: header, borders
   * and trailing margin. Measured from the current card, which is never
   * dropped, so the decision cannot come to depend on its own outcome.
   */
  previousChromePx: number;
  /**
   * Smallest content height worth the card's chrome; defaults to the context
   * reserve. A preview that cannot show as much thought as the paragraph it
   * displaces has stopped paying for its space.
   */
  minContentHeightPx?: number;
}

/**
 * Content height a wrapped previous preview may claim, or `null` to drop it.
 *
 * The caller supplies a measured viewport height: with no viewport measurement
 * there is no budget to enforce and the card keeps its ordinary cap instead.
 */
export function stackedThinkingBudgetPx({
  viewportHeightPx,
  trailingContentPx,
  contextReservePx,
  previousTopPx,
  previousChromePx,
  minContentHeightPx,
}: StackedThinkingBudgetInput): number | null {
  const availablePx =
    conversationRowHeightCeilingPx(
      viewportHeightPx,
      trailingContentPx + contextReservePx,
    ) -
    previousTopPx -
    previousChromePx;
  const minimumPx = minContentHeightPx ?? contextReservePx;
  return availablePx >= minimumPx ? availablePx : null;
}

/**
 * Tallest the activity row may become and still leave the preceding paragraph
 * visible. This also bounds the held height reserve: after the viewport shrinks
 * the row must not go on claiming space the viewport no longer has.
 */
export function conversationRowHeightCeilingPx(
  viewportHeightPx: number,
  reservedPx: number,
): number {
  return Math.max(0, viewportHeightPx - reservedPx);
}

/**
 * Ignore shrinks this small when publishing a measured CSS length. Two CSS
 * pixels is one hairline on each side of a box, and it is also the observed
 * amplitude of the conversation-activity row's follow-mode vertical squirm.
 * Growth still publishes immediately so a wrapping line is not delayed.
 */
export const CONVERSATION_LAYOUT_HYSTERESIS_PX = 2;

/**
 * Same-line vs wrapped decision for the current and previous thinking cards.
 *
 * The previous comparison was a 1px ceiling with no deadband, so a 2px
 * subpixel/baseline wobble classified the pair as stacked, the stacked cap
 * moved a card, and the next measure classified them as sharing a line again.
 * Enter "same line" at 1px (the original slack); leave it only once the
 * previous card is more than 4px below — a real wrap, not measurement noise.
 */
export const SHARE_FLEX_LINE_AT_OR_BELOW_PX = 1;
export const STACK_FLEX_LINE_ABOVE_PX = 4;

/**
 * Fold a new measurement into the last published CSS length: grow at once,
 * ignore shrinks of {@link CONVERSATION_LAYOUT_HYSTERESIS_PX} or less.
 */
export function stabilizePublishedPx(
  previousPx: number | null,
  measuredPx: number,
  hysteresisPx: number = CONVERSATION_LAYOUT_HYSTERESIS_PX,
): number {
  if (previousPx === null || measuredPx > previousPx) return measuredPx;
  if (previousPx - measuredPx <= hysteresisPx) return previousPx;
  return measuredPx;
}

/**
 * Whether two thinking cards still share a flex line, with a deadband so a
 * 2px top-delta cannot flap stacked vs side-by-side.
 *
 * `previousMinusLatestTopPx` is signed the same way the layout reads it:
 * ~0 when they share a line, large and positive when the previous card wrapped
 * below. Negative (previous above) still counts as sharing a line.
 */
export function cardsShareFlexLine(
  previousMinusLatestTopPx: number,
  previouslyShared: boolean,
  shareAtOrBelowPx: number = SHARE_FLEX_LINE_AT_OR_BELOW_PX,
  stackAbovePx: number = STACK_FLEX_LINE_ABOVE_PX,
): boolean {
  if (previousMinusLatestTopPx <= shareAtOrBelowPx) return true;
  if (previousMinusLatestTopPx > stackAbovePx) return false;
  return previouslyShared;
}
