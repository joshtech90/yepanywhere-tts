/**
 * A bounded preview of a running tool's output: its first and last part,
 * with the size of the middle left out.
 */
export interface LiveToolOutput {
  head: string;
  tail: string;
  omittedChars: number;
}

export function renderLiveToolOutput(
  output: LiveToolOutput,
  omittedUnit: "characters" | "bytes" = "characters",
): string {
  if (output.omittedChars === 0) return `${output.head}${output.tail}`;
  return `${output.head}\n… ${output.omittedChars} ${omittedUnit} omitted from the live preview; the completed result shows the full output …\n${output.tail}`;
}
