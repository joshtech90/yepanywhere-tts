/** Safe evidence only: this bus never accepts credentials, frames, or exceptions. */
export interface ResumeObservation {
  attemptId: string;
  sessionId: string;
  mode?: "direct" | "relay";
  endpoint?: string;
  identity?: string;
  relayUsername?: string;
  phase: string;
  event:
    | "started"
    | "challenge"
    | "proof"
    | "authenticated"
    | "rejected"
    | "incompatible"
    | "timeout"
    | "verification"
    | "protocol"
    | "server"
    | "superseded"
    | "quarantined"
    | "storage_failure"
    | "coordination_unavailable";
  at: number;
  elapsedMs: number;
  clientVersion: string;
  protocolVersion?: number;
  reason?:
    | "expired"
    | "invalid_proof"
    | "unknown"
    | "stored_protocol"
    | "server_refused";
}
const listeners = new Set<(event: ResumeObservation) => void>();
export function emitResumeObservation(event: ResumeObservation): void {
  for (const listener of listeners) listener(event);
}
export function subscribeResumeObservations(
  listener: (event: ResumeObservation) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
