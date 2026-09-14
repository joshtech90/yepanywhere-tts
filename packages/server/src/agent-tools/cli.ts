import { get } from "node:http";
import {
  AGENT_SELF_EXIT_CODES,
  AGENT_SELF_MAX_BYTES,
  AGENT_SELF_PATH,
  isAgentSelfReport,
  type AgentSelfErrorCode,
} from "./protocol.js";

function fail(code: AgentSelfErrorCode): void {
  const json = process.argv.includes("--json");
  const text = json
    ? JSON.stringify({ schemaVersion: 1, error: { code } })
    : `ya-agent self: ${code}`;
  (json ? process.stdout : process.stderr).write(`${text}\n`);
  process.exitCode = AGENT_SELF_EXIT_CODES[code];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "help")) {
    process.stdout.write(
      "Usage: ya-agent self [--json]\nReads the owning YA session; does not attest to a child agent's model.\n",
    );
    return;
  }
  if (
    args[0] !== "self" ||
    args.length > 2 ||
    (args.length === 2 && args[1] !== "--json")
  ) {
    fail("usage");
    return;
  }
  const base = process.env.AGENT_YA_API_URL;
  const token = process.env.AGENT_YA_API_TOKEN;
  const sessionId = process.env.AGENTCTL_SESSION_ID;
  if (!base || !token) return fail("unavailable");
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
      return fail("unavailable");
    }
    url.pathname = AGENT_SELF_PATH;
  } catch {
    return fail("unavailable");
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
    return fail("owner-unavailable");
  }
  try {
    const result = JSON.parse(response.body);
    if (result?.schemaVersion !== 1) return fail("unsupported-protocol");
    if (response.status !== 200) {
      const code = result?.error?.code;
      return fail(
        typeof code === "string" && Object.hasOwn(AGENT_SELF_EXIT_CODES, code)
          ? (code as AgentSelfErrorCode)
          : "invalid-response",
      );
    }
    if (
      !isAgentSelfReport(result) ||
      (sessionId && result.sessionId !== sessionId)
    )
      return fail("invalid-response");
    const report = result;
    if (args.includes("--json"))
      process.stdout.write(`${JSON.stringify(report)}\n`);
    else {
      const value = (field: { value: string | null; status: string }) =>
        field.value ?? field.status;
      process.stdout.write(
        [
          `YA session: ${report.sessionId} (owning session; child model may differ)`,
          `Harness: ${report.harness}; provider: ${report.provider}`,
          `Launch: ${value(report.launch.model)}; effort ${value(report.launch.effort)}`,
          `Selected: ${value(report.selected.model)}; effort ${value(report.selected.effort)}`,
          `Provider evidence: ${value(report.providerEvidence.model)} (${report.providerEvidence.model.source}); effort ${value(report.providerEvidence.effort)} (${report.providerEvidence.effort.source})`,
          `Pending effort: ${report.pending.effort}; active inference: unknown`,
          `Observed: ${report.observedAt}`,
          "",
        ].join("\n"),
      );
    }
  } catch {
    fail("invalid-response");
  }
}
void main().catch(() => fail("owner-unavailable"));
