import type { z } from "zod";
import type { ToolCallItem } from "@yep-anywhere/shared/transcript/items";

export type DisplayStatus = ToolCallItem["status"];
export interface DisplayRecord {
  input: unknown;
  result?: unknown;
  status: DisplayStatus;
  isError?: boolean;
  toolName?: string;
}
/** The positional `(input, result, isError)` dispatch arguments as a record.
 * A call carrying no result is still running unless it failed; a caller whose
 * surface only exists once the call settled passes `status` itself.
 */
export function recordFromLegacyArgs(
  input: unknown,
  result: unknown,
  isError: boolean,
  status: DisplayStatus = isError
    ? "error"
    : result === undefined
      ? "pending"
      : "complete",
): DisplayRecord {
  return { input, result, isError, status };
}

/** The effective error flag: a result's own flag when the provider set one,
 * otherwise the call's status. `pending`, `incomplete` and `aborted` are not
 * failures. `topics/rich-text-rendering.md` names this the one interpretation.
 */
export function effectiveToolError(
  record: Pick<DisplayRecord, "status" | "isError">,
): boolean {
  return record.isError ?? record.status === "error";
}

/** The same flag for a transcript invocation, which carries the result flag on
 * the result rather than beside the status. */
export function effectiveInvocationError(
  item: Pick<ToolCallItem, "status" | "toolResult">,
): boolean {
  return effectiveToolError({
    status: item.status,
    isError: item.toolResult?.isError,
  });
}

export interface DisplayContract<
  I extends z.ZodType,
  R extends z.ZodType,
  F extends z.ZodType = R,
> {
  input: I;
  result: R;
  partialResult?: z.ZodType<string>;
  /** A rejection's own shape, which need not be the success shape. When it is
   * not, the registration must render it through its own `renderFailure`. */
  failure?: F;
  variants: readonly [string, ...string[]];
  standaloneResult: boolean;
  standaloneResultSchema?: z.ZodType<z.output<R>>;
}

/** Bounded, data-only preparation shared by native parity and mounted dispatch.
 * A rejection has its own optional display contract, never the success schema.
 * There is no transcript scan, mutation, cache, or provider conversion here.
 */
export function prepareDisplay<
  I extends z.ZodType,
  R extends z.ZodType,
  F extends z.ZodType = R,
>(contract: DisplayContract<I, R, F>, record: DisplayRecord) {
  const isError = effectiveToolError(record);
  const input = contract.input.safeParse(record.input);
  const resultSchema = isError
    ? contract.failure
    : record.input === undefined
      ? (contract.standaloneResultSchema ?? contract.result)
      : contract.result;
  const result =
    record.result === undefined
      ? undefined
      : resultSchema?.safeParse(record.result);
  const partialResult =
    !isError && result && !result.success
      ? contract.partialResult?.safeParse(record.result)
      : undefined;
  const inputEligible =
    input.success ||
    (record.input === undefined &&
      contract.standaloneResult &&
      (result?.success || partialResult?.success));
  const reason = !inputEligible
    ? ("input" as const)
    : (isError && !contract.failure) ||
        (result && !result.success && !partialResult?.success)
      ? ("result" as const)
      : undefined;
  return {
    kind: reason
      ? ("raw" as const)
      : partialResult?.success
        ? ("partial" as const)
        : ("rich" as const),
    reason,
    status: record.status,
    isError,
    input,
    result,
    partialResult,
    inputEligible,
  };
}
