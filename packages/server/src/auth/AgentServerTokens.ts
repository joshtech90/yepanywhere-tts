import { createHash, randomBytes } from "node:crypto";

/** The provider environment variable that carries one launch's token. */
export const AGENT_SERVER_TOKEN_ENV = "AGENT_SERVER_TOKEN";

/** A token minted for one provider launch, and its revocation. */
export interface AgentServerAccess {
  token: string;
  revoke(): void;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Bearer tokens that let an unsandboxed superuser agent session call this
 * server's API as the superuser (topics/agent-session-access.md § Operator
 * API token).
 *
 * Tokens exist only in this process's memory and in the environment of the
 * provider process each was minted for: never in a file, a log, or a response.
 * A sandboxed session can read the operator's files but not another
 * process's environment, so it cannot discover one. Only digests are kept, so
 * a lookup reveals nothing through timing. A server restart forgets every
 * token; a session launched before it gets a new one when it next launches.
 */
export class AgentServerTokens {
  private readonly digests = new Set<string>();

  constructor(private readonly isEnabled: () => boolean) {}

  /** Mint a token for one launch, or nothing while the setting is off. */
  mint(): AgentServerAccess | undefined {
    if (!this.isEnabled()) return undefined;
    const token = randomBytes(32).toString("base64url");
    const key = digest(token);
    this.digests.add(key);
    return { token, revoke: () => this.digests.delete(key) };
  }

  /** Whether `token` is live and the setting still allows its use. */
  accepts(token: string): boolean {
    return this.isEnabled() && this.digests.has(digest(token));
  }

  /** Forget every token, so turning the setting back on revives none. */
  revokeAll(): void {
    this.digests.clear();
  }
}

/** The token in an `Authorization: Bearer` header, if the header has one. */
export function bearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(authorization ?? "");
  return match?.[1] ?? null;
}
