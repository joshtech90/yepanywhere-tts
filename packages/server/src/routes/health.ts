import { Hono } from "hono";

export const health = new Hono();

health.get("/", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

interface ActivitySource {
  getAllProcesses(): ReadonlyArray<{ state: { type: string } }>;
}

/** How many live sessions a server restart would interrupt right now. */
export function countBusyProcesses(source: ActivitySource): {
  inTurn: number;
  waitingInput: number;
  busy: number;
} {
  let inTurn = 0;
  let waitingInput = 0;
  for (const process of source.getAllProcesses()) {
    if (process.state.type === "in-turn") inTurn += 1;
    else if (process.state.type === "waiting-input") waitingInput += 1;
  }
  return { inTurn, waitingInput, busy: inTurn + waitingInput };
}
