/** Evidence from a specific resume attempt, never inferred from UI copy. */
export type ResumeFailureKind =
  | "timeout"
  | "rejected"
  | "incompatible"
  | "verification"
  | "protocol"
  | "server";

export class ResumeError extends Error {
  constructor(
    readonly kind: ResumeFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "ResumeError";
  }

  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "server";
  }
}

export function getResumeError(error: unknown): ResumeError | undefined {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof ResumeError) return error;
    seen.add(error);
    error = error.cause;
  }
  return undefined;
}
