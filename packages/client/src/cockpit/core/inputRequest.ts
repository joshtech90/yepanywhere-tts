import type { InputRequest, UserQuestionAnswers } from "../../types";

export interface CockpitInputTransport {
  fetch<T>(path: string, init?: RequestInit): Promise<T>;
}

export type CockpitInputResponse =
  | "approve"
  | "approve_accept_edits"
  | "deny";

export class CockpitInputRejectedError extends Error {
  readonly status = 400;

  constructor() {
    super("COCKPIT_INPUT_REJECTED");
    this.name = "CockpitInputRejectedError";
  }
}

export async function respondToCockpitInput(
  transport: CockpitInputTransport,
  sessionId: string,
  requestId: string,
  response: CockpitInputResponse,
  answers?: UserQuestionAnswers,
  feedback?: string,
): Promise<InputRequest | null> {
  const result = await transport.fetch<{
    accepted: boolean;
    pendingInputRequest?: InputRequest | null;
  }>(`/sessions/${encodeURIComponent(sessionId)}/input`, {
    method: "POST",
    body: JSON.stringify({ requestId, response, answers, feedback }),
  });
  if (!result.accepted) {
    throw new CockpitInputRejectedError();
  }
  return result.pendingInputRequest ?? null;
}

export async function readCockpitPendingInput(
  transport: CockpitInputTransport,
  sessionId: string,
): Promise<InputRequest | null> {
  const result = await transport.fetch<{ request: InputRequest | null }>(
    `/sessions/${encodeURIComponent(sessionId)}/pending-input`,
  );
  return result.request;
}
