/**
 * Label rendered code blocks with their language, and hand the ones a
 * registered renderer claims to that renderer.
 *
 * Works on already-rendered markup rather than on source, so one hook covers
 * completed augments, streaming augments, and markdown file previews alike.
 * See `topics/code-fence-renderers.md`.
 */

import { type RefObject, useEffect } from "react";
import { resolveAppearance } from "../lib/codeFence/mermaidRenderer";
import {
  type CodeFenceRenderer,
  getCodeFenceRenderer,
} from "../lib/codeFence/renderers";
import styles from "./useCodeFenceRenderers.module.css";

/**
 * Belongs on the container passed to `useCodeFenceRenderers`, so the hook's
 * stylesheet can scope under it. The hook enhances whatever container it is
 * given; this is the caller's half of that arrangement.
 */
export const codeFenceRootClass: string = styles.root ?? "";

const CODE_SELECTOR = "pre > code[class*='language-']";
const LANGUAGE_CLASS = /(?:^|\s)language-(\S+)/;

/** How long a tap keeps the language label visible on a touch device. */
const LABEL_REVEAL_MS = 2500;

// The hook's own DOM contract. Styling scopes off these too, so the selectors
// its tests use are the selectors the stylesheet uses.
const BLOCK = "data-ya-code-block";
const RENDERED = "data-ya-code-rendered";
const TOGGLE = "data-ya-code-toggle";

/**
 * Rendered markup, keyed by renderer, appearance, and source. A React
 * re-render replaces the container's markup wholesale, so without this a
 * stable code block would re-render its diagram on every unrelated update.
 *
 * Entries hold rendered SVG and a long session can scroll past many diagrams,
 * so the cache is bounded and evicts the oldest. Returning to an evicted
 * diagram re-renders it.
 */
const RENDER_CACHE_LIMIT = 50;
const renderCache = new Map<string, string | null>();

function cacheRender(key: string, markup: string | null): void {
  renderCache.set(key, markup);
  while (renderCache.size > RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next();
    if (oldest.done) {
      return;
    }
    renderCache.delete(oldest.value);
  }
}

function cacheKey(
  renderer: CodeFenceRenderer,
  source: string,
  appearance: string,
): string {
  // Length-prefixing the source keeps the key unambiguous: a language name
  // and an appearance never contain a pipe, and the length pins where the
  // source begins, so two different inputs cannot produce one key.
  return `${renderer.language}|${appearance}|${source.length}|${source}`;
}

/**
 * No `title`: the stylesheet already reveals the language on hover, and a
 * native tooltip on every code block would fire constantly while reading or
 * selecting code, a second later and saying the same word.
 */
function labelBlock(pre: HTMLElement, language: string): void {
  if (pre.dataset.yaCodeLanguage === language) {
    return;
  }
  pre.dataset.yaCodeLanguage = language;
  pre.setAttribute("aria-label", `${language} code block`);
}

function makeToggle(doc: Document, renderer: CodeFenceRenderer): HTMLElement {
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.setAttribute(TOGGLE, "");
  toggle.innerHTML =
    '<svg class="render-mode-glyph" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<text x="8" y="8.1" text-anchor="middle" dominant-baseline="central" ' +
    'font-family="KaTeX_Main, Times New Roman, serif" font-size="12.5" font-weight="500" ' +
    'fill="currentColor">Σ</text></svg>';
  toggle.dataset.yaRenderedNoun = renderer.renderedNoun;
  return toggle;
}

/**
 * The label names the block, not just the view, because the enclosing
 * assistant message has its own source/rendered toggle: a bare "Show source"
 * on both leaves two buttons with one name in the same message.
 */
function describeToggle(toggle: HTMLElement, showingRendered: boolean): void {
  const noun = toggle.dataset.yaRenderedNoun ?? "rendered view";
  const label = showingRendered ? `Show ${noun} source` : `Show ${noun}`;
  toggle.setAttribute("aria-pressed", String(showingRendered));
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
}

function setView(block: HTMLElement, view: "rendered" | "source"): void {
  block.dataset.yaCodeView = view;
  const toggle = block.querySelector<HTMLElement>(`[${TOGGLE}]`);
  if (toggle) {
    describeToggle(toggle, view === "rendered");
  }
}

/**
 * Put `markup` beside `pre` inside a shared block wrapper, creating the
 * wrapper and its toggle on first use. The wrapper is what carries the
 * source-versus-rendered choice, so the toggle can hide either child.
 */
function mount(
  pre: HTMLElement,
  markup: string,
  key: string,
  renderer: CodeFenceRenderer,
): void {
  const doc = pre.ownerDocument;
  const parent = pre.parentElement;
  let block = parent?.hasAttribute(BLOCK) === true ? parent : undefined;

  if (!block) {
    block = doc.createElement("div");
    block.setAttribute(BLOCK, "");
    pre.replaceWith(block);
    block.append(pre);
    block.append(makeToggle(doc, renderer));
  }

  let rendered = block.querySelector<HTMLElement>(`[${RENDERED}]`);
  if (!rendered) {
    rendered = doc.createElement("div");
    rendered.setAttribute(RENDERED, "");
    block.insertBefore(rendered, pre);
  }
  rendered.innerHTML = markup;

  block.dataset.yaRenderKey = key;
  // A block the user has switched to source keeps that choice across
  // re-renders of its content.
  setView(block, block.dataset.yaCodeView === "source" ? "source" : "rendered");
}

async function renderBlock(
  pre: HTMLElement,
  code: HTMLElement,
  renderer: CodeFenceRenderer,
): Promise<void> {
  const source = code.textContent ?? "";
  if (source.trim() === "") {
    return;
  }

  const key = cacheKey(renderer, source, resolveAppearance(pre.ownerDocument));
  const block = pre.closest(`[${BLOCK}]`);
  if (block instanceof HTMLElement && block.dataset.yaRenderKey === key) {
    return;
  }
  // One attempt per exact source. A streaming block whose source grows gets a
  // new key and is tried again; one that declined is not retried in a loop.
  if (pre.dataset.yaRenderAttempt === key) {
    return;
  }
  pre.dataset.yaRenderAttempt = key;

  let markup = renderCache.get(key);
  if (markup === undefined) {
    markup = await renderer.render(source);
    cacheRender(key, markup);
  }
  if (markup === null || !pre.isConnected) {
    return;
  }

  mount(pre, markup, key, renderer);
}

function enhance(root: ParentNode): void {
  for (const code of root.querySelectorAll<HTMLElement>(CODE_SELECTOR)) {
    const pre = code.parentElement;
    if (!pre) {
      continue;
    }
    const language = LANGUAGE_CLASS.exec(code.className)?.[1]?.toLowerCase();
    if (!language) {
      continue;
    }

    labelBlock(pre, language);

    const renderer = getCodeFenceRenderer(language);
    if (renderer) {
      void renderBlock(pre, code, renderer);
    }
  }
}

/**
 * Enhance every rendered code block inside `rootRef`, and keep doing it as
 * the container's content changes.
 */
export function useCodeFenceRenderers(
  rootRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    let scheduled = false;
    let labelTimer: number | undefined;

    const refresh = () => {
      scheduled = false;
      enhance(root);
    };

    // Streaming augments mutate the container per token, so coalesce to one
    // pass per frame rather than scanning on every mutation.
    const schedule = () => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(refresh);
      } else {
        window.setTimeout(refresh, 0);
      }
    };

    const onClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const toggle = target.closest(`[${TOGGLE}]`);
      const block = toggle?.closest(`[${BLOCK}]`);
      if (toggle && block instanceof HTMLElement) {
        // The enclosing transcript row treats content clicks as link/media
        // gestures; this one is ours.
        event.stopPropagation();
        event.preventDefault();
        setView(
          block,
          block.dataset.yaCodeView === "source" ? "rendered" : "source",
        );
        return;
      }

      // Tap-to-reveal, so the language is reachable without a hover pointer.
      const pre = target.closest<HTMLElement>("pre[data-ya-code-language]");
      if (!pre) {
        return;
      }
      for (const shown of root.querySelectorAll<HTMLElement>(
        "pre[data-ya-code-language-shown]",
      )) {
        delete shown.dataset.yaCodeLanguageShown;
      }
      pre.dataset.yaCodeLanguageShown = "1";
      window.clearTimeout(labelTimer);
      labelTimer = window.setTimeout(() => {
        delete pre.dataset.yaCodeLanguageShown;
      }, LABEL_REVEAL_MS);
    };

    refresh();
    root.addEventListener("click", onClick);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });

    // A rendered diagram carries its own colors, so it has to be redrawn when
    // YA's light/dark appearance changes. The cache key includes appearance,
    // so a refresh is all this needs.
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(root.ownerDocument.documentElement, {
      attributeFilter: ["data-theme"],
      attributes: true,
    });
    const systemDark = root.ownerDocument.defaultView?.matchMedia?.(
      "(prefers-color-scheme: dark)",
    );
    systemDark?.addEventListener?.("change", schedule);

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      systemDark?.removeEventListener?.("change", schedule);
      root.removeEventListener("click", onClick);
      window.clearTimeout(labelTimer);
    };
  }, [rootRef]);
}
