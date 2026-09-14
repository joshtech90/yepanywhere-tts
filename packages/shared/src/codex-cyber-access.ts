/**
 * Codex cyber access program selection.
 *
 * Codex sends an access program with each turn so the backend knows which
 * program's policy applies. Omitting it preserves Codex's automatic choice,
 * which is what the first-party terminal client does, so `provider-default`
 * stays YA's default and sends nothing. The named programs are only honored
 * for ChatGPT-authenticated accounts enrolled in them; requesting one does not
 * grant access.
 */
export const CODEX_CYBER_ACCESS_PROGRAMS = [
  "provider-default",
  "standard",
  "daybreak-blue",
  "daybreak-red",
] as const;

export type CodexCyberAccessProgram =
  (typeof CODEX_CYBER_ACCESS_PROGRAMS)[number];

export const DEFAULT_CODEX_CYBER_ACCESS_PROGRAM: CodexCyberAccessProgram =
  "provider-default";

export function isCodexCyberAccessProgram(
  value: unknown,
): value is CodexCyberAccessProgram {
  return CODEX_CYBER_ACCESS_PROGRAMS.some((program) => program === value);
}

/**
 * Wire spelling Codex expects on `turn/start`. `provider-default` has none:
 * the field is omitted entirely.
 */
export function codexCyberAccessProgramWireValue(
  program: CodexCyberAccessProgram,
): "standard" | "daybreakBlue" | "daybreakRed" | null {
  switch (program) {
    case "standard":
      return "standard";
    case "daybreak-blue":
      return "daybreakBlue";
    case "daybreak-red":
      return "daybreakRed";
    default:
      return null;
  }
}
