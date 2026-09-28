/**
 * Yep Anywhere's pi extension, loaded into every pi session YA launches
 * (`pi --extension <this file>`). It registers one command, which only YA
 * sends, and changes nothing else about the session.
 *
 * `/yep-anywhere-effort-retry <json>` sets aside a turn the model server
 * refused over its thinking level, so YA can send the prompt again without
 * the model context and the session file holding it twice. pi's RPC has no
 * continue, retry or tree-navigation command, but a command's context has
 * `navigateTree`: moving the leaf to before the refused prompt leaves the
 * prompt and its error reply on an abandoned branch, and the resent prompt
 * starts the active one.
 *
 * The JSON argument is `{ refusedLevel, retryLevel, error }`, recorded as a
 * custom entry on the active branch. Custom entries never enter the model's
 * context; YA's session reader shows this one as the refusal notice.
 *
 * Any state other than "the session ends in a failed reply to a prompt"
 * throws. pi reports the throw as an `extension_error` line before the
 * command's response, which is how YA learns the prompt must not be resent.
 * The names below are repeated in pi-effort-retry.ts; a test pins them.
 */

const EFFORT_RETRY_COMMAND = "yep-anywhere-effort-retry";
const EFFORT_RETRY_ENTRY_TYPE = "yep-anywhere.effort-retry";

export default function yepAnywherePiExtension(pi) {
  pi.registerCommand(EFFORT_RETRY_COMMAND, {
    description:
      "Yep Anywhere: set aside a turn refused over its thinking level",
    handler: async (args, ctx) => {
      const record = JSON.parse(args);
      const refused = ctx.sessionManager.getLeafEntry();
      if (
        refused?.type !== "message" ||
        refused.message.role !== "assistant" ||
        refused.message.stopReason !== "error"
      ) {
        throw new Error(
          "Yep Anywhere effort retry: the session does not end in a failed reply",
        );
      }
      const prompt = refused.parentId
        ? ctx.sessionManager.getEntry(refused.parentId)
        : undefined;
      if (prompt?.type !== "message" || prompt.message.role !== "user") {
        throw new Error(
          "Yep Anywhere effort retry: the failed reply does not answer a prompt directly",
        );
      }
      const { cancelled } = await ctx.navigateTree(prompt.id);
      if (cancelled) {
        throw new Error(
          "Yep Anywhere effort retry: another extension cancelled the navigation",
        );
      }
      pi.appendEntry(EFFORT_RETRY_ENTRY_TYPE, {
        refusedLevel: String(record.refusedLevel),
        retryLevel: String(record.retryLevel),
        error: String(record.error),
      });
    },
  });
}
