/** Server-wide advisory executable, invoked without a shell in the project. */
export interface ProjectQueueReadinessCommand {
  executable: string;
  args: string[];
}

export function isProjectQueueReadinessCommand(
  value: unknown,
): value is ProjectQueueReadinessCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  return (
    typeof command.executable === "string" &&
    command.executable.trim().length > 0 &&
    command.executable.length <= 4096 &&
    !command.executable.includes("\0") &&
    Array.isArray(command.args) &&
    command.args.length <= 128 &&
    command.args.every(
      (arg) => typeof arg === "string" && !arg.includes("\0"),
    ) &&
    command.args.reduce(
      (length, arg) => length + new TextEncoder().encode(arg).byteLength,
      0,
    ) <= 16384
  );
}
