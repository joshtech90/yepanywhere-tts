export interface RendezUserTurn {
  projectPath: string;
  harness: "claude" | "codex";
  sessionId: string;
  providerSessionId: string;
  receivedAt: number;
}

export function publishRendezUserTurn(
  turn: RendezUserTurn,
  onError: (error: Error) => void,
): void;

export function flushRendezUserTurn(projectPath: string): void;
