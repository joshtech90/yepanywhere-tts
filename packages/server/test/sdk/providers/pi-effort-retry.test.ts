import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  PI_EFFORT_RETRY_COMMAND,
  PI_EFFORT_RETRY_ENTRY_TYPE,
  piEffortRetryNoticeText,
  yepAnywherePiExtensionPath,
} from "../../../src/sdk/providers/pi-effort-retry.js";

interface RegisteredCommand {
  handler: (args: string, ctx: unknown) => Promise<void>;
}

/** Load the extension file YA passes to pi, through a stand-in for pi's API. */
async function loadExtension() {
  const commands = new Map<string, RegisteredCommand>();
  const appendEntry = vi.fn();
  const extension = (await import(
    pathToFileURL(yepAnywherePiExtensionPath()).href
  )) as { default: (pi: unknown) => void };
  extension.default({
    registerCommand: (name: string, command: RegisteredCommand) =>
      commands.set(name, command),
    appendEntry,
  });
  return { commands, appendEntry };
}

function sessionEndingIn(entries: Record<string, unknown>[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    getLeafEntry: () => entries.at(-1),
    getEntry: (id: string) => byId.get(id),
  };
}

const prompt = {
  type: "message",
  id: "u1",
  parentId: "a0",
  message: { role: "user", content: "ping" },
};
const refusedReply = {
  type: "message",
  id: "a1",
  parentId: "u1",
  message: { role: "assistant", content: [], stopReason: "error" },
};
const record = {
  refusedLevel: "high",
  retryLevel: "medium",
  error: "400 Unexpected reasoning effort high.",
};

describe("YA's pi extension", () => {
  it("registers the one command YA sends, under the name YA sends", async () => {
    const { commands } = await loadExtension();
    expect([...commands.keys()]).toEqual([PI_EFFORT_RETRY_COMMAND]);
  });

  it("moves the session to before the refused prompt and records the refusal", async () => {
    const { commands, appendEntry } = await loadExtension();
    const navigateTree = vi.fn(async () => ({ cancelled: false }));
    await commands
      .get(PI_EFFORT_RETRY_COMMAND)
      ?.handler(JSON.stringify(record), {
        sessionManager: sessionEndingIn([prompt, refusedReply]),
        navigateTree,
      });
    expect(navigateTree).toHaveBeenCalledWith("u1");
    expect(appendEntry).toHaveBeenCalledWith(
      PI_EFFORT_RETRY_ENTRY_TYPE,
      record,
    );
  });

  it("refuses when the session does not end in a failed reply to a prompt", async () => {
    const { commands, appendEntry } = await loadExtension();
    const navigateTree = vi.fn(async () => ({ cancelled: false }));
    const answered = {
      ...refusedReply,
      message: { role: "assistant", content: [], stopReason: "stop" },
    };
    const afterTool = { ...refusedReply, parentId: "tool-result" };
    const toolResult = {
      type: "message",
      id: "tool-result",
      parentId: "u1",
      message: { role: "toolResult", content: [] },
    };
    for (const entries of [
      [prompt, answered],
      [prompt, toolResult, afterTool],
    ]) {
      await expect(
        commands.get(PI_EFFORT_RETRY_COMMAND)?.handler(JSON.stringify(record), {
          sessionManager: sessionEndingIn(entries),
          navigateTree,
        }),
      ).rejects.toThrow(/^Yep Anywhere effort retry:/);
    }
    expect(navigateTree).not.toHaveBeenCalled();
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("records nothing when another extension cancels the navigation", async () => {
    const { commands, appendEntry } = await loadExtension();
    await expect(
      commands.get(PI_EFFORT_RETRY_COMMAND)?.handler(JSON.stringify(record), {
        sessionManager: sessionEndingIn([prompt, refusedReply]),
        navigateTree: async () => ({ cancelled: true }),
      }),
    ).rejects.toThrow(/cancelled/);
    expect(appendEntry).not.toHaveBeenCalled();
  });
});

describe("refusal notice", () => {
  it("quotes every line of the server's refusal", () => {
    expect(
      piEffortRetryNoticeText(
        { ...record, error: "400 first line\nsecond line\n" },
        false,
      ),
    ).toBe(
      "_This model refused thinking level **high**. Later turns ask for " +
        "**medium**; send the prompt again to retry it._\n\n" +
        "> 400 first line\n> second line",
    );
  });
});
