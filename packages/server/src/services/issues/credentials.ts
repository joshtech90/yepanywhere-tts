import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  IssueCredentialProvider,
  IssueCredentialSource,
  IssueCredentialStatus,
} from "@yep-anywhere/shared";

const run = promisify(execFile);

/**
 * Where a tracker credential can come from, in resolution order.
 *
 * A key entered in Settings wins, so an installation can override an
 * environment that belongs to something else. Environment variables come next,
 * most specific first. GitHub adds the signed-in `gh` CLI last, because that is
 * where a developer machine usually keeps its token and asking costs one local
 * process.
 */
export const ISSUE_CREDENTIAL_ENV: Record<IssueCredentialProvider, string[]> = {
  github: ["YEP_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"],
  jira: ["YEP_JIRA_API_TOKEN", "JIRA_API_TOKEN", "ATLASSIAN_API_TOKEN"],
};

const STORED_LABEL = "Key stored in Settings";
const GH_CLI = "gh auth token";
const PROVIDERS: IssueCredentialProvider[] = ["github", "jira"];

export interface IssueCredentialsDeps {
  /** Data directory; the stored keys live beside the other server state. */
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Overridden by tests; returns the signed-in GitHub CLI token or null. */
  cliToken?: () => Promise<string | null>;
}

async function ghToken(): Promise<string | null> {
  const { stdout } = await run("gh", ["auth", "token"], {
    timeout: 5_000,
    env: { ...process.env, GH_PAGER: "" },
  });
  return stdout.trim() || null;
}

/**
 * Resolves tracker credentials and reports where they come from.
 *
 * Stored keys are written to their own mode-600 file rather than into server
 * settings, which the settings route hands to any authenticated client. No
 * method returns a key to a caller that only asked about presence.
 */
export class IssueCredentials {
  private stored: Partial<Record<IssueCredentialProvider, string>> | null =
    null;
  private cliCache?: { token: string | null; at: number };
  private readonly path: string | null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cliToken: () => Promise<string | null>;
  constructor(deps: IssueCredentialsDeps = {}) {
    this.path = deps.dataDir
      ? join(deps.dataDir, "issue-credentials.json")
      : null;
    this.env = deps.env ?? process.env;
    this.cliToken = deps.cliToken ?? ghToken;
  }

  private async load(): Promise<
    Partial<Record<IssueCredentialProvider, string>>
  > {
    if (this.stored) return this.stored;
    const keys: Partial<Record<IssueCredentialProvider, string>> = {};
    const raw = this.path
      ? await readFile(this.path, "utf8").catch(() => null)
      : null;
    try {
      const parsed = raw === null ? {} : (JSON.parse(raw) as unknown);
      for (const provider of PROVIDERS) {
        const value = (parsed as Record<string, unknown>)?.[provider];
        if (typeof value === "string" && value) keys[provider] = value;
      }
    } catch {
      // A corrupt file is not a reason to serve a key from somewhere else
      // silently; treat it as no stored key and let the caller store again.
    }
    this.stored = keys;
    return keys;
  }

  /** A GitHub CLI answer is reused briefly so one page of UI costs one spawn. */
  private async cli(): Promise<string | null> {
    if (this.cliCache && Date.now() - this.cliCache.at < 10_000)
      return this.cliCache.token;
    const token = await this.cliToken().catch(() => null);
    this.cliCache = { token, at: Date.now() };
    return token;
  }

  /** Store a key, or clear it when the value is empty. */
  async store(provider: IssueCredentialProvider, key: string): Promise<void> {
    if (!this.path)
      throw new Error("This server has no data directory for stored keys");
    const keys = { ...(await this.load()) };
    if (key) keys[provider] = key;
    else delete keys[provider];
    await mkdir(dirname(this.path), { recursive: true });
    const staging = `${this.path}.${process.pid}`;
    await writeFile(staging, `${JSON.stringify(keys, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(staging, 0o600);
    await rename(staging, this.path);
    this.stored = keys;
  }

  /** The credential a lookup would use, with the name of its source. */
  async resolve(
    provider: IssueCredentialProvider,
  ): Promise<{ token: string; source: string } | null> {
    const stored = (await this.load())[provider];
    if (stored) return { token: stored, source: STORED_LABEL };
    for (const name of ISSUE_CREDENTIAL_ENV[provider]) {
      const value = this.env[name];
      if (value) return { token: value, source: name };
    }
    if (provider !== "github") return null;
    const token = await this.cli();
    return token ? { token, source: GH_CLI } : null;
  }

  /** Presence and origin for the settings pane; never a key. */
  async status(): Promise<IssueCredentialStatus[]> {
    const stored = await this.load();
    const statuses: IssueCredentialStatus[] = [];
    for (const provider of PROVIDERS) {
      const sources: IssueCredentialSource[] = [
        {
          name: STORED_LABEL,
          kind: "stored" as const,
          present: Boolean(stored[provider]),
        },
        ...ISSUE_CREDENTIAL_ENV[provider].map((name) => ({
          name,
          kind: "env" as const,
          present: Boolean(this.env[name]),
        })),
      ];
      if (provider === "github")
        sources.push({
          name: GH_CLI,
          kind: "cli" as const,
          present: Boolean(await this.cli()),
        });
      statuses.push({
        provider,
        sources,
        active: sources.find((source) => source.present)?.name ?? null,
      });
    }
    return statuses;
  }
}
