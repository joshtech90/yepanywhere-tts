import type {
  AgentSelfReport,
  AgentSelfSelection,
  AgentSelfValue,
} from "../../agent-tools/protocol.js";
import { createAgentSelfLease } from "../../agent-tools/service.js";
import type { SDKMessage } from "../types.js";
import type {
  AgentSession,
  ProviderName,
  StartSessionOptions,
} from "./types.js";

export function agentSelfEnabled(): boolean {
  return (
    process.env.YEP_AGENT_SELF === "1" || process.env.YEP_AGENT_SELF === "true"
  );
}

function value(
  input: string | null | undefined,
  source: string,
  scope: AgentSelfValue["scope"],
  absent: "default" | "unknown" = "unknown",
): AgentSelfValue {
  return {
    value: input || null,
    status: input ? "known" : absent,
    source,
    scope,
    observedAt: new Date().toISOString(),
  };
}

/** Observation projection only; provider controls remain owned by the adapter. */
export class AgentSelfState {
  sessionId: string | undefined;
  private readonly launch: AgentSelfReport["launch"];
  private selected: AgentSelfReport["selected"];
  private evidence: AgentSelfReport["providerEvidence"];
  private pendingEffort = false;

  constructor(
    private readonly provider: ProviderName,
    options: StartSessionOptions,
  ) {
    this.sessionId = options.resumeSessionId;
    this.launch = {
      model: value(options.model, "launch-request", "launch", "default"),
      effort: value(options.effort, "launch-request", "launch", "default"),
    };
    this.selected = {
      model: value(options.model, "launch-request", "session", "default"),
      effort: value(options.effort, "launch-request", "session", "default"),
    };
    this.evidence = {
      model: value(null, "unobserved", "session"),
      effort: value(null, "unobserved", "session"),
    };
  }

  select(selection: AgentSelfSelection): void {
    if ("model" in selection)
      this.selected.model = value(
        selection.model,
        "supervisor-selection",
        "session",
        "default",
      );
    if ("effort" in selection)
      this.selected.effort = value(
        selection.effort,
        "supervisor-selection",
        "session",
        "default",
      );
    if (selection.pendingEffort !== undefined)
      this.pendingEffort = selection.pendingEffort;
  }

  accepted(setting: "model" | "effort", input: string | undefined): void {
    // This says what the adapter accepted, never which inference request uses it.
    this.evidence[setting] = value(input, "adapter-control", "session");
  }

  observe(message: SDKMessage): void {
    if (message.type === "system" && message.subtype === "init") {
      if (!this.sessionId && typeof message.session_id === "string")
        this.sessionId = message.session_id;
      if (typeof message.model === "string")
        this.evidence.model = value(message.model, "provider-init", "session");
    }
    if (message.type === "system" && message.subtype === "config_ack") {
      if (typeof message.configModel === "string")
        this.evidence.model = value(
          message.configModel,
          "provider-config-ack",
          "session",
        );
      if (typeof message.configThinking === "string")
        this.evidence.effort = value(
          message.configThinking,
          "provider-config-ack",
          "session",
        );
    }
    if (
      message.type === "assistant" &&
      typeof message.message?.model === "string"
    ) {
      this.evidence.model = value(
        message.message.model,
        "provider-assistant",
        "response",
      );
    }
  }

  snapshot(launchId: string): AgentSelfReport | null {
    if (!this.sessionId) return null;
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      scope: "owning-session",
      sessionId: this.sessionId,
      launchId,
      launcher: "yepanywhere",
      harness: this.provider.startsWith("claude") ? "claude" : "codex",
      provider: this.provider,
      launch: this.launch,
      selected: this.selected,
      providerEvidence: this.evidence,
      pending: { effort: this.pendingEffort },
      activeInference: "unknown",
    };
  }
}

function eligible(
  provider: ProviderName,
  options: StartSessionOptions,
): boolean {
  if (!(options.agentSelf ?? agentSelfEnabled())) return false;
  if (
    options.executor ||
    options.sessionSandbox ||
    options.sessionSandboxOptions?.level === "project-write"
  )
    return false;
  if (provider === "codex")
    return options.permissionMode === "bypassPermissions";
  return (
    provider === "claude" ||
    provider === "claude-gateway" ||
    provider === "claude-ollama"
  );
}

export async function startAgentSelfSession(
  provider: ProviderName,
  options: StartSessionOptions,
  start: (options: StartSessionOptions) => Promise<AgentSession>,
): Promise<AgentSession> {
  if (!eligible(provider, options))
    return await start({ ...options, agentEnvironment: undefined });
  const state = new AgentSelfState(provider, options);
  const lease = await createAgentSelfLease((launchId) =>
    state.snapshot(launchId),
  );
  const environment = {
    ...lease.environment,
    AGENT_LAUNCHER: "yepanywhere",
    AGENT_LAUNCH_HARNESS: provider.startsWith("claude") ? "claude" : "codex",
    AGENT_LAUNCH_MODEL: options.model ?? "",
    AGENT_LAUNCH_EFFORT: options.effort ?? "",
  };
  let session: AgentSession;
  try {
    session = await start({
      ...options,
      agentEnvironment: environment,
      getSessionChildEnv: (sessionId, executor) => ({
        ...options.getSessionChildEnv?.(sessionId, executor),
        ...environment,
      }),
    });
  } catch (error) {
    await lease.dispose();
    throw error;
  }
  const original = session;
  const iterator = (async function* () {
    try {
      for await (const message of original.iterator) {
        state.observe(message);
        yield message;
      }
    } finally {
      await lease.dispose();
    }
  })();
  // Preserve live getters (notably provider pid), rather than spreading session.
  return new Proxy(session, {
    get(target, property) {
      if (property === "iterator") return iterator;
      if (property === "publishAgentSelfSelection")
        return (selection: AgentSelfSelection) => state.select(selection);
      if (property === "publishAgentctlSessionId")
        return async (
          sessionId: string,
          environment?: Record<string, string>,
        ) => {
          state.sessionId = sessionId;
          await original.publishAgentctlSessionId?.(sessionId, environment);
        };
      if (property === "abort")
        return async () => {
          try {
            await lease.dispose();
          } finally {
            await original.abort();
          }
        };
      if (property === "setModel" && original.setModel)
        return async (model?: string) => {
          await original.setModel?.(model);
          state.select({ model: model ?? null });
          state.accepted("model", model);
        };
      if (property === "setEffort" && original.setEffort)
        return async (
          effort?: Parameters<NonNullable<AgentSession["setEffort"]>>[0],
        ) => {
          state.select({ effort: effort ?? null });
          await original.setEffort?.(effort);
          state.accepted("effort", effort);
        };
      return Reflect.get(target, property, target);
    },
  });
}
