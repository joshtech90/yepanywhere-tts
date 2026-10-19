/** Indexes complete Markdown quote replies by quoted text, with whitespace folded. */
export function quoteReplyKey(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Reads quote blocks followed by reply text, excluding quotes inside code fences. */
export function collectQuoteReplies(text: string): Map<string, string> {
  const replies = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  let quote: string[] = [];
  let answer: string[] = [];
  let quoting = false;
  let fence: string | undefined;
  const finish = () => {
    const key = quoteReplyKey(quote.join("\n"));
    const addition = answer.join("\n").trim();
    if (key && addition) replies.set(key, addition);
    quote = [];
    answer = [];
  };
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    const quoted = !fence && !marker ? /^ {0,3}>[ \t]?(.*)$/.exec(line) : null;
    if (quoted) {
      if (!quoting) finish();
      quoting = true;
      quote.push(quoted[1]!);
      continue;
    }
    quoting = false;
    if (quote.length) answer.push(line);
    if (marker) {
      if (!fence) fence = marker;
      else if (
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      )
        fence = undefined;
    }
  }
  finish();
  return replies;
}
