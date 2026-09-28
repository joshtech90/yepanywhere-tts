export interface ArtifactSourceTarget {
  id: string;
  source: string;
  sourceRange: [[number, number], [number, number]];
}

/**
 * A mapped HTML document reduced to what the selection view needs: its targets
 * and one sanitized, target-annotated serialization. It holds no parsed
 * document and no copy of the producer's HTML, so a large artifact costs one
 * parse and one serialization however often the view is re-derived.
 */
export interface ArtifactEditPreview {
  targets: ArtifactSourceTarget[];
  mapUrl?: string;
  /** Selection document with `nonce`-keyed slots for the asset-base parts. */
  snapshot: string;
  nonce: string;
}

const ACTIVE_CONTENT = new Set([
  "SCRIPT",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
  "BASE",
  "META",
  "FORM",
]);

function policySlot(nonce: string): string {
  return `ya-edit-policy-${nonce}`;
}
function baseSlot(nonce: string): string {
  return `ya-edit-base-${nonce}`;
}

/**
 * Read producer-authored HTML comment targets (zero-based coordinates) and
 * build the isolated static selection view in the same pass over one parse.
 */
export function prepareArtifactEditPreview(
  html: string,
  nonce: string,
): ArtifactEditPreview {
  const document = new DOMParser().parseFromString(html, "text/html");
  const walker = document.createTreeWalker(
    document,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT,
  );
  const targets: ArtifactSourceTarget[] = [];
  const stack: Array<{
    id: string;
    target?: ArtifactSourceTarget;
  }> = [];
  const ids = new Set<string>();
  const activeContent: Element[] = [];
  let mapUrl: string | undefined;
  // Advance before handling a node: wrapping a text node moves it into a new
  // span, and the walk must continue from where that node used to be.
  let next = walker.nextNode();
  while (next) {
    const comment = next;
    next = walker.nextNode();
    if (comment instanceof Element) {
      if (ACTIVE_CONTENT.has(comment.tagName)) activeContent.push(comment);
      const attributes = comment.attributes;
      for (let index = attributes.length - 1; index >= 0; index--) {
        const name = attributes[index]!.name;
        if (
          name.startsWith("on") ||
          name === "nonce" ||
          name === "srcdoc" ||
          name === "data-ya-edit-target"
        )
          comment.removeAttribute(name);
      }
    }
    if (comment.nodeType !== Node.COMMENT_NODE) {
      const target = stack.at(-1)?.target;
      if (
        target &&
        comment instanceof Element &&
        !["HTML", "HEAD", "BODY", "SCRIPT", "STYLE"].includes(comment.tagName)
      ) {
        comment.setAttribute("data-ya-edit-target", target.id);
        comment.setAttribute("tabindex", "0");
      } else if (
        target &&
        comment.nodeType === Node.TEXT_NODE &&
        comment.textContent?.trim() &&
        !comment.parentElement?.closest("script,style,title") &&
        comment.parentElement?.getAttribute("data-ya-edit-target") !== target.id
      ) {
        const span = document.createElement("span");
        span.setAttribute("data-ya-edit-target", target.id);
        span.setAttribute("tabindex", "0");
        comment.parentNode?.insertBefore(span, comment);
        span.append(comment);
      }
      continue;
    }
    const text = comment.textContent?.trim() ?? "";
    if (text.startsWith("# sourceMappingURL=")) {
      if (mapUrl !== undefined)
        throw new Error("Multiple HTML source maps are ambiguous");
      mapUrl = text.slice("# sourceMappingURL=".length).trim();
      if (!mapUrl || /^[a-z][a-z\d+.-]*:|^\/|^\\/i.test(mapUrl))
        throw new Error(
          "The HTML source map must be a relative file reference",
        );
    } else if (text.startsWith("ya-source-target:v1 ")) {
      const value: unknown = JSON.parse(
        text.slice("ya-source-target:v1 ".length),
      );
      if (
        !value ||
        typeof value !== "object" ||
        !("id" in value) ||
        typeof value.id !== "string" ||
        !value.id ||
        ids.has(value.id)
      )
        throw new Error("Invalid or duplicate HTML source target");
      ids.add(value.id);
      if (ids.size > 10000) throw new Error("Too many HTML source targets");
      const record = value as Record<string, unknown>;
      let target: ArtifactSourceTarget | undefined;
      if (record.source !== undefined) {
        const range = record.sourceRange;
        if (
          typeof record.source !== "string" ||
          !record.source ||
          !Array.isArray(range) ||
          range.length !== 2 ||
          !range.every(
            (point) =>
              Array.isArray(point) &&
              point.length === 2 &&
              point.every((n) => Number.isSafeInteger(n) && n >= 0),
          )
        )
          throw new Error("Invalid HTML source target range");
        const sourceRange = range as ArtifactSourceTarget["sourceRange"];
        if (
          sourceRange[1][0] < sourceRange[0][0] ||
          (sourceRange[1][0] === sourceRange[0][0] &&
            sourceRange[1][1] < sourceRange[0][1])
        )
          throw new Error("Reversed HTML source target range");
        target = { id: value.id, source: record.source, sourceRange };
        targets.push(target);
      }
      stack.push({ id: value.id, target });
    } else if (text.startsWith("/ya-source-target:v1 ")) {
      const entry = stack.pop();
      if (
        !entry ||
        entry.id !== text.slice("/ya-source-target:v1 ".length).trim()
      )
        throw new Error("Unmatched HTML source target markers");
    }
  }
  if (stack.length) throw new Error("Unclosed HTML source target marker");
  for (const element of activeContent) element.remove();
  const head = document.head;
  const referrer = document.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  head.prepend(document.createComment(policySlot(nonce)), referrer);
  const style = document.createElement("style");
  style.textContent =
    "[data-ya-edit-target]{cursor:text} [data-ya-edit-target]:hover,[data-ya-edit-target]:focus{outline:2px solid #5688dd;outline-offset:3px}";
  head.append(document.createComment(baseSlot(nonce)), style);
  const script = document.createElement("script");
  script.setAttribute("nonce", nonce);
  script.textContent = `document.addEventListener('click',select,true);document.addEventListener('keydown',function(e){if(e.key==='Enter')select(e)},true);function select(e){e.preventDefault();e.stopPropagation();var target=e.target.closest('[data-ya-edit-target]');if(target)parent.postMessage({type:'ya-source-target',nonce:${JSON.stringify(nonce)},id:target.getAttribute('data-ya-edit-target')},'*')}`;
  document.body.append(script);
  return {
    targets,
    mapUrl,
    snapshot: `<!doctype html>${document.documentElement.outerHTML}`,
    nonce,
  };
}

/** Resolve source paths against the sidecar's directory without fetching URLs. */
export function artifactTargetPath(source: string, mapUrl?: string): string {
  if (
    /^[a-z][a-z\d+.-]*:/i.test(source) ||
    source.startsWith("//") ||
    source.includes("\\")
  )
    throw new Error("Source target must be a local relative or absolute path");
  if (source.startsWith("/")) return source;
  const mapDirectory = mapUrl?.slice(0, mapUrl.lastIndexOf("/") + 1) ?? "";
  return `${mapDirectory}${source}`;
}

/**
 * Isolated static selection view: only our nonce-authorized bridge may run.
 * `assetBase` lets page assets load from an artifact origin; filling the two
 * slots slices the prepared snapshot rather than parsing or copying a DOM.
 */
export function createArtifactEditDocument(
  preview: ArtifactEditPreview,
  assetBase?: string,
): string {
  const origin = assetBase ? new URL(assetBase).origin : "";
  const policy = `default-src 'none'; script-src 'nonce-${preview.nonce}'; style-src 'unsafe-inline' ${origin}; img-src data: blob: ${origin}; font-src data: ${origin}; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri ${origin || "'none'"}`;
  const base = assetBase
    ? `<base href="${assetBase.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`
    : "";
  const snapshot = preview.snapshot;
  const policyMark = `<!--${policySlot(preview.nonce)}-->`;
  const baseMark = `<!--${baseSlot(preview.nonce)}-->`;
  const policyAt = snapshot.indexOf(policyMark);
  const baseAt = snapshot.indexOf(baseMark, policyAt);
  if (policyAt < 0 || baseAt < 0)
    throw new Error("Selection snapshot is missing its policy slots");
  return (
    snapshot.slice(0, policyAt) +
    `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
    snapshot.slice(policyAt + policyMark.length, baseAt) +
    base +
    snapshot.slice(baseAt + baseMark.length)
  );
}
