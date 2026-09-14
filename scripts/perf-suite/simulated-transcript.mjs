import { appendFile } from "node:fs/promises";
import path from "node:path";

// Fixture persistence for the browser's REST refreshes. This is not the real
// provider SDK writer; it preserves exactly the simulated turn's identities.
export async function appendSimulatedTranscriptTurn({
  directory,
  sessionId,
  cwd,
  userMessage,
  assistant,
  parentUuid,
}) {
  const timestamp = new Date().toISOString();
  const userUuid = userMessage.uuid ?? `perf-user-${assistant.uuid}`;
  const shared = { sessionId, cwd, timestamp, isSidechain: false };
  const rows = [
    {
      ...shared,
      type: "user",
      uuid: userUuid,
      parentUuid,
      message: { role: "user", content: userMessage.text },
    },
    { ...assistant, ...shared, parentUuid: userUuid },
  ];
  await appendFile(
    path.join(directory, `${sessionId}.jsonl`),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}
