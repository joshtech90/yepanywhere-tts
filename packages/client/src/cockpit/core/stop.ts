export interface CockpitStopClient {
  abortProcess: (processId: string) => Promise<unknown>;
  interruptProcess: (processId: string) => Promise<{
    aborted?: boolean;
    interrupted: boolean;
    supported: boolean;
  }>;
}

export type CockpitStopOutcome = "aborted" | "interrupted";

/**
 * Ask the provider to stop gracefully, retaining the existing hard-abort
 * fallback for older servers and providers that cannot interrupt a turn.
 */
export async function requestCockpitStop(
  client: CockpitStopClient,
  processId: string,
): Promise<CockpitStopOutcome> {
  try {
    const result = await client.interruptProcess(processId);
    if (result.interrupted) return "interrupted";
    if (result.aborted) return "aborted";
  } catch {
    // Older servers and transient interrupt-route failures use the established
    // abort fallback below. Its failure remains visible to the caller.
  }

  await client.abortProcess(processId);
  return "aborted";
}
