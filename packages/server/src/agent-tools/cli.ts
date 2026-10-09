import { get } from "node:http";
import type { SessionClientView } from "@yep-anywhere/shared";
import {
  AGENT_SELF_EXIT_CODES,
  AGENT_SELF_MAX_BYTES,
  AGENT_SELF_PATH,
  AGENT_VIEW_PATH,
  type AgentSelfErrorCode,
  type AgentSelfReport,
  type AgentViewReport,
  isAgentSelfReport,
  isAgentViewReport,
} from "./protocol.js";

const USAGE = [
  "Usage: ya-agent self [--json]",
  "       ya-agent view [--json] [--all]",
  "self: reads the owning YA session; does not attest to a child agent's model.",
  "view: reports what each browser tab shows beside the owning session; --all lists every tab, not only the most recently focused.",
  "",
].join("\n");

const COMMANDS = {
  self: { path: AGENT_SELF_PATH, flags: ["--json"] },
  view: { path: AGENT_VIEW_PATH, flags: ["--json", "--all"] },
} as const;
type Command = keyof typeof COMMANDS;

function fail(command: string, code: AgentSelfErrorCode): void {
  const json = process.argv.includes("--json");
  const text = json
    ? JSON.stringify({ schemaVersion: 1, error: { code } })
    : `ya-agent ${command}: ${code}`;
  (json ? process.stdout : process.stderr).write(`${text}\n`);
  process.exitCode = AGENT_SELF_EXIT_CODES[code];
}

function formatSelf(report: AgentSelfReport): string {
  const value = (field: { value: string | null; status: string }) =>
    field.value ?? field.status;
  return [
    `YA session: ${report.sessionId} (owning session; child model may differ)`,
    `Harness: ${report.harness}; provider: ${report.provider}`,
    `Launch: ${value(report.launch.model)}; effort ${value(report.launch.effort)}`,
    `Selected: ${value(report.selected.model)}; effort ${value(report.selected.effort)}`,
    `Provider evidence: ${value(report.providerEvidence.model)} (${report.providerEvidence.model.source}); effort ${value(report.providerEvidence.effort)} (${report.providerEvidence.effort.source})`,
    `Pending effort: ${report.pending.effort}; active inference: unknown`,
    `Observed: ${report.observedAt}`,
    "",
  ].join("\n");
}

function formatClient(client: SessionClientView, selected: boolean): string[] {
  const focus = client.focused
    ? "focused now"
    : client.focusedAt
      ? `last focused ${client.focusedAt}`
      : "never focused";
  const lines = [
    `Client ${client.clientId} (${client.device}${selected ? ", selected" : ""}): ${focus}; reported ${client.publishedAt}`,
  ];
  if (client.viewers.length === 0)
    lines.push("  Transcript only: no app, artifact or file open beside it");
  for (const viewer of client.viewers) {
    const target = viewer.target ?? "(no address)";
    lines.push(
      `  ${viewer.kind} "${viewer.label}": ${target}`,
      `    ${viewer.state} in ${viewer.placement}; opened by ${viewer.openedBy}${viewer.url && viewer.url !== viewer.target ? `; browser address ${viewer.url}` : ""}`,
    );
  }
  return lines;
}

function formatView(report: AgentViewReport, all: boolean): string {
  const lines = [`YA session: ${report.sessionId}`];
  if (report.clients.length === 0) {
    lines.push("No browser tab has reported a view of this session.");
  } else {
    const shown = all
      ? report.clients
      : report.clients.filter(
          (client) => client.clientId === report.selectedClientId,
        );
    lines.push(
      `Selected: ${report.selection.replaceAll("-", " ")} of ${report.clients.length} reporting tab(s)`,
    );
    for (const client of shown)
      lines.push(
        ...formatClient(client, client.clientId === report.selectedClientId),
      );
    if (!all && report.clients.length > 1)
      lines.push(
        `${report.clients.length - 1} other tab(s) differ or are stale; run with --all`,
      );
  }
  lines.push(`Observed: ${report.observedAt}`, "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "help")) {
    process.stdout.write(USAGE);
    return;
  }
  const command = args[0] as Command;
  const flags = args.slice(1);
  if (
    !Object.hasOwn(COMMANDS, command) ||
    new Set(flags).size !== flags.length ||
    !flags.every((flag) =>
      (COMMANDS[command].flags as readonly string[]).includes(flag),
    )
  ) {
    fail(args[0] ?? "", "usage");
    return;
  }
  const base = process.env.AGENT_YA_API_URL;
  const token = process.env.AGENT_YA_API_TOKEN;
  const sessionId = process.env.AGENTCTL_SESSION_ID;
  if (!base || !token) return fail(command, "unavailable");
  let url: URL;
  try {
    url = new URL(base);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return fail(command, "unavailable");
    }
    url.pathname = COMMANDS[command].path;
  } catch {
    return fail(command, "unavailable");
  }
  let response: { status: number; body: string };
  try {
    response = await new Promise((resolve, reject) => {
      const request = get(
        url,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(sessionId ? { "X-Agent-Session-Id": sessionId } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > AGENT_SELF_MAX_BYTES)
              request.destroy(new Error("Response too large"));
            else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      const timer = setTimeout(
        () => request.destroy(new Error("Lookup timed out")),
        5000,
      );
      request.once("close", () => clearTimeout(timer));
      request.once("error", reject);
    });
  } catch {
    return fail(command, "owner-unavailable");
  }
  try {
    const result = JSON.parse(response.body);
    if (result?.schemaVersion !== 1)
      return fail(command, "unsupported-protocol");
    if (response.status !== 200) {
      const code = result?.error?.code;
      return fail(
        command,
        typeof code === "string" && Object.hasOwn(AGENT_SELF_EXIT_CODES, code)
          ? (code as AgentSelfErrorCode)
          : "invalid-response",
      );
    }
    const valid =
      command === "self"
        ? isAgentSelfReport(result)
        : isAgentViewReport(result);
    if (!valid || (sessionId && result.sessionId !== sessionId))
      return fail(command, "invalid-response");
    if (flags.includes("--json"))
      process.stdout.write(`${JSON.stringify(result)}\n`);
    else
      process.stdout.write(
        command === "self"
          ? formatSelf(result as AgentSelfReport)
          : formatView(result as AgentViewReport, flags.includes("--all")),
      );
  } catch {
    fail(command, "invalid-response");
  }
}
void main().catch(() => fail(process.argv[2] ?? "", "owner-unavailable"));
