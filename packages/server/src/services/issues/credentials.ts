import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  IssueCredentialProvider,
  IssueCredentialSource,
  IssueCredentialStatus,
  IssueSettings,
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
  cliToken?: (account?: string) => Promise<string | null>;
  cliIdentity?: () => Promise<{ accounts: string[]; active?: string }>;
  settings?: () => IssueSettings;
}

function cliEnvironment(): NodeJS.ProcessEnv {
  // Both account inventory and token selection describe saved CLI accounts.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GH_PAGER: "",
    GH_PROMPT_DISABLED: "1",
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

async function ghToken(account?: string): Promise<string | null> {
  const { stdout } = await run(
    "gh",
    [
      "auth",
      "token",
      "--hostname",
      "github.com",
      ...(account ? ["--user", account] : []),
    ],
    {
      timeout: 5_000,
      env: cliEnvironment(),
    },
  );
  return stdout.trim() || null;
}

async function ghIdentity(): Promise<{ accounts: string[]; active?: string }> {
  const { stdout } = await run(
    "gh",
    ["auth", "status", "--hostname", "github.com", "--json", "hosts"],
    {
      timeout: 5_000,
      env: cliEnvironment(),
    },
  );
  // gh's JSON can contain credentials. Retain only these non-secret fields.
  const entries =
    (
      JSON.parse(stdout) as {
        hosts?: Record<string, Array<{ login?: string; active?: boolean }>>;
      }
    ).hosts?.["github.com"] ?? [];
  return {
    accounts: entries.flatMap((x) => (x.login ? [x.login] : [])),
    active: entries.find((x) => x.active)?.login,
  };
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
  private cliCache?: { token: string | null; at: number; account: string };
  private readonly path: string | null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cliToken: (account?: string) => Promise<string | null>;
  private readonly cliIdentity: () => Promise<{
    accounts: string[];
    active?: string;
  }>;
  private readonly settings?: () => IssueSettings;

  constructor(deps: IssueCredentialsDeps = {}) {
    this.path = deps.dataDir
      ? join(deps.dataDir, "issue-credentials.json")
      : null;
    this.env = deps.env ?? process.env;
    this.cliToken = deps.cliToken ?? ghToken;
    this.cliIdentity =
      deps.cliIdentity ??
      (deps.cliToken ? async () => ({ accounts: [] }) : ghIdentity);
    this.settings = deps.settings;
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
  private cliPolicy(): { enabled: boolean; account: string } {
    const settings = this.settings?.();
    const optedIn =
      !settings ||
      Boolean(settings.confirmation?.enabled || settings.githubStatusEnabled);
    return {
      enabled: optedIn && settings?.githubCli?.enabled !== false,
      account: settings?.githubCli?.account ?? "",
    };
  }

  private async cli(): Promise<string | null> {
    const { enabled, account } = this.cliPolicy();
    if (!enabled) {
      this.cliCache = undefined;
      return null;
    }
    if (
      this.cliCache?.account === account &&
      Date.now() - this.cliCache.at < 10_000
    )
      return this.cliCache.token;
    const token = await this.cliToken(account || undefined).catch(() => null);
    // A setting may change while a local command is running.
    const current = this.cliPolicy();
    if (!current.enabled || current.account !== account) return null;
    this.cliCache = { token, at: Date.now(), account };
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
    const policy = this.cliPolicy();
    if (provider === "github" && policy.enabled && policy.account) {
      const token = await this.cli();
      return token ? { token, source: `${GH_CLI} (${policy.account})` } : null;
    }
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
      const policy = this.cliPolicy();
      let identity: { accounts: string[]; active?: string } = { accounts: [] };
      if (provider === "github") {
        const token = await this.cli();
        if (policy.enabled)
          identity = await this.cliIdentity().catch(() => ({ accounts: [] }));
        sources.push({
          name: policy.account ? `${GH_CLI} (${policy.account})` : GH_CLI,
          kind: "cli",
          present: Boolean(token),
        });
      }
      const selected =
        provider === "github" && policy.enabled && policy.account;
      statuses.push({
        provider,
        sources,
        active: selected
          ? sources.at(-1)?.present
            ? sources.at(-1)!.name
            : null
          : (sources.find((source) => source.present)?.name ?? null),
        ...(provider === "github"
          ? {
              account: policy.account || identity.active,
              accounts: identity.accounts,
            }
          : {}),
      });
    }
    return statuses;
  }
}
