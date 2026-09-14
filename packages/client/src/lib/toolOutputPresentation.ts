import { AcliRecordFramer } from "@yep-anywhere/shared";

export interface ToolOutputPart {
  kind: "text" | "json" | "metadata";
  source: string;
  text: string;
}

/** Recognition is presentation only; it grants no execution or commentary capability. */
export function isAcliMetadata(source: string): boolean {
  const line = source.trim().replace(/^#\s*/, "");
  return (
    /^acli: 1(?:\s+\+?[a-z][a-z0-9-]*)*$/.test(line) ||
    /^acli-capabilities: (?:[a-z][a-z0-9-]*\/1)(?:\s+[a-z][a-z0-9-]*\/1)*$/.test(
      line,
    )
  );
}

// Format validated JSON lexically so large integers, duplicate keys, and
// source escapes survive exactly. Parsing and reserializing would lose them.
function indentJson(source: string): string {
  JSON.parse(source);
  const tokens =
    source.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g) ?? [];
  let depth = 0;
  let result = "";
  const newline = () => `\n${"  ".repeat(depth)}`;
  tokens.forEach((token, index) => {
    if (token === "{" || token === "[") {
      result += token;
      depth++;
      if (tokens[index + 1] !== (token === "{" ? "}" : "]"))
        result += newline();
    } else if (token === "}" || token === "]") {
      depth--;
      if (tokens[index - 1] !== (token === "}" ? "{" : "["))
        result += newline();
      result += token;
    } else if (token === ",") result += token + newline();
    else if (token === ":") result += ": ";
    else result += token;
  });
  return result + (source.endsWith("\n") ? "\n" : "");
}

/** Call separately for each stdout/stderr or decoded command-result block. */
export function presentToolOutput(source: string): ToolOutputPart[] {
  const framer = new AcliRecordFramer();
  const frames = [...framer.append(source), ...framer.finish()];
  let fence: string | undefined;
  return frames.map((frame): ToolOutputPart => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(frame)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      return { kind: "text", source: frame, text: frame };
    }
    if (!fence && isAcliMetadata(frame))
      return { kind: "metadata", source: frame, text: frame };
    if (!fence && /^[\s]*[[{]/.test(frame)) {
      try {
        return { kind: "json", source: frame, text: indentJson(frame) };
      } catch {
        // Incomplete and non-JSON output remains verbatim, including truncation.
      }
    }
    return { kind: "text", source: frame, text: frame };
  });
}
