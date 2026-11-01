import type { IssueItem } from "@yep-anywhere/shared";

export interface IssueMentionLinks {
  destinations: ReadonlyMap<string, string>;
  pattern: RegExp;
}

/** Resolve issue mentions only when this session supplies one destination. */
export function createIssueMentionLinks(
  items: readonly Pick<IssueItem, "key" | "url" | "provider">[],
): IssueMentionLinks | null {
  const candidates = new Map<string, string | null>();
  const add = (key: string, url: string | null) => {
    candidates.set(
      key,
      candidates.has(key) && candidates.get(key) !== url ? null : url,
    );
  };
  for (const item of items) {
    const url = item.url && /^https?:\/\//i.test(item.url) ? item.url : null;
    add(item.key, url);
    if (item.provider === "github") {
      const match = item.key.match(/^[^/]+\/([^#]+)(#[1-9]\d*)$/);
      if (match) {
        add(`${match[1]}${match[2]}`, url);
        add(match[2]!, url);
      }
    }
  }
  const destinations = new Map<string, string>();
  for (const [key, url] of candidates) {
    if (url) destinations.set(key, url);
  }
  if (!destinations.size) return null;
  const alternatives = [...destinations.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return {
    destinations,
    pattern: new RegExp(
      `(?<![\\w/.-])(?:${alternatives.join("|")})(?![\\w/-])`,
      "g",
    ),
  };
}

/** Decorate prose in a detached rendered fragment, leaving links/code intact. */
export function annotateIssueMentionsHtml(
  html: string,
  links: IssueMentionLinks | null,
): string {
  if (
    !links ||
    typeof document === "undefined" ||
    html.search(links.pattern) < 0
  )
    return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_TEXT,
  );
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (
      !node.parentElement?.closest(
        "a, code, pre, button, script, style, textarea, .katex",
      )
    )
      nodes.push(node);
  }
  let changed = false;
  for (const node of nodes) {
    const matches = [...node.data.matchAll(links.pattern)];
    for (const match of matches.reverse()) {
      const start = match.index;
      node.splitText(start + match[0].length);
      const mention = node.splitText(start);
      const anchor = document.createElement("a");
      anchor.href = links.destinations.get(match[0])!;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = mention.data;
      mention.replaceWith(anchor);
      changed = true;
    }
  }
  return changed ? template.innerHTML : html;
}
