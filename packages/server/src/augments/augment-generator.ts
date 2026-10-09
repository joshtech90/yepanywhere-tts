/**
 * AugmentGenerator - Renders completed markdown blocks to HTML
 *
 * Uses the shared Shiki highlight worker for code blocks and markdown-it for
 * rendering other markdown blocks. Also provides lightweight inline
 * formatting for pending/incomplete text during streaming.
 */

import {
  hasAnsiEscapes,
  looksLikeToon,
  parseToonDocument,
  renderAnsiToHtml,
  toonDocumentToMarkdown,
} from "@yep-anywhere/shared";
import { bundledLanguages } from "shiki";
import {
  HighlightWorkerUnavailableError,
  highlightWorker,
} from "../highlighting/highlight-worker-host.js";
import type {
  CompletedBlock,
  StreamingCodeBlock,
  StreamingList,
} from "./block-detector.js";
import { normalizeCodeBlockLanguage } from "./code-language.js";
import {
  getLocalPathExtension,
  isLocalFilePath,
  MEDIA_EXTENSIONS,
  renderLocalFileLink,
  renderLocalMediaLink,
  renderSafeMarkdown,
  type SafeMarkdownRenderOptions,
  sanitizeUrl,
} from "./safe-markdown.js";

export interface Augment {
  blockIndex: number;
  html: string;
  type: CompletedBlock["type"];
  /**
   * Set when highlighting was temporarily unavailable and the block fell back
   * to plain output; a later render may differ, so do not retain this HTML.
   */
  degraded?: boolean;
}

export interface AugmentGenerator {
  processBlock(
    block: CompletedBlock,
    blockIndex: number,
    safeMarkdownOptions?: SafeMarkdownRenderOptions,
  ): Promise<Augment>;
  renderPending(pending: string): string; // Lightweight inline formatting for trailing text
  renderStreamingCodeBlock(
    block: StreamingCodeBlock,
    blockIndex: number,
  ): Promise<Augment>; // Render incomplete code block optimistically
  renderStreamingList(
    block: StreamingList,
    blockIndex: number,
    safeMarkdownOptions?: SafeMarkdownRenderOptions,
  ): Augment; // Render incomplete list optimistically
}

/**
 * Creates an AugmentGenerator. Finalized code blocks are highlighted by the
 * process-wide highlight worker, so a generator holds no Shiki state and
 * needs no disposal.
 */
export async function createAugmentGenerator(): Promise<AugmentGenerator> {
  return {
    async processBlock(
      block: CompletedBlock,
      blockIndex: number,
      safeMarkdownOptions?: SafeMarkdownRenderOptions,
    ): Promise<Augment> {
      if (block.type === "code") {
        const code = extractCodeContent(block.content);
        const lang = normalizeCodeBlockLanguage(block.lang) ?? "";
        try {
          const html = await renderCodeWithHighlighter(code, lang);
          return { blockIndex, html, type: block.type };
        } catch (error) {
          if (!(error instanceof HighlightWorkerUnavailableError)) throw error;
          const html = renderPlainCodeBlock(code, lang);
          return { blockIndex, html, type: block.type, degraded: true };
        }
      }

      const html = renderMarkdownBlock(block, safeMarkdownOptions);
      return { blockIndex, html, type: block.type };
    },

    renderPending(pending: string): string {
      return renderInlineFormatting(pending);
    },

    async renderStreamingCodeBlock(
      block: StreamingCodeBlock,
      blockIndex: number,
    ): Promise<Augment> {
      const code = extractStreamingCodeContent(block.content);
      const lang = normalizeCodeBlockLanguage(block.lang) ?? "";

      // Avoid running Shiki over the whole growing code block on every token.
      // Completed code blocks still get full syntax highlighting through
      // processBlock once the closing fence arrives.
      const html = renderPlainCodeBlock(code, lang);
      return { blockIndex, html, type: "code" };
    },

    renderStreamingList(
      block: StreamingList,
      blockIndex: number,
      safeMarkdownOptions?: SafeMarkdownRenderOptions,
    ): Augment {
      const html = renderMarkdownBlock(
        {
          type: "list",
          content: block.content,
          startOffset: block.startOffset,
          endOffset: block.startOffset + block.content.length,
        },
        safeMarkdownOptions,
      );
      return { blockIndex, html, type: "list" };
    },
  };
}

/**
 * Extract code content from a code block, removing the fence markers.
 */
function extractCodeContent(content: string): string {
  const lines = content.split("\n");
  if (lines.length < 2) return "";

  // Remove first line (opening fence) and last line (closing fence if present)
  const hasClosingFence =
    lines.length > 1 &&
    /^(`{3,}|~{3,})$/.test((lines[lines.length - 1] ?? "").trim());

  const codeLines = hasClosingFence ? lines.slice(1, -1) : lines.slice(1);

  return codeLines.join("\n");
}

/**
 * Extract code content from a streaming code block (no closing fence).
 */
function extractStreamingCodeContent(content: string): string {
  const lines = content.split("\n");
  if (lines.length < 2) return "";

  // Remove first line (opening fence), keep everything else
  return lines.slice(1).join("\n");
}

/**
 * Render code with syntax highlighting. `lang` must already have been put
 * through `normalizeCodeBlockLanguage`, so every comparison below sees the
 * same lowercase single-token form the emitted `language-*` class carries.
 */
async function renderCodeWithHighlighter(
  code: string,
  normalizedLang: string,
): Promise<string> {
  // Route colored terminal output through the ANSI renderer when the
  // fence is tagged `ansi` or contains raw CSI bytes; otherwise shiki
  // would render the escapes literally.
  if (normalizedLang === "ansi" || hasAnsiEscapes(code)) {
    return renderAnsiBlock(code);
  }

  // TOON flat tables (acli's opt-in tabular format) render as real tables
  // via the existing markdown pipeline; a failed strict parse falls through
  // to ordinary highlighting.
  if (normalizedLang === "toon" || (!normalizedLang && looksLikeToon(code))) {
    const tables = parseToonDocument(code);
    if (tables) {
      return renderSafeMarkdown(toonDocumentToMarkdown(tables));
    }
  }

  if (normalizedLang && normalizedLang in bundledLanguages) {
    try {
      // Shiki carries the language only in its token colors, so stamp the
      // same `language-*` class the plain fallback emits. That single class
      // is what lets the client label a block and pick a per-language
      // renderer without re-reading the original fence.
      return await highlightWorker.highlight(
        code,
        normalizedLang,
        `language-${normalizedLang}`,
      );
    } catch (error) {
      // An unavailable worker is reported to processBlock so its fallback is
      // not retained; a language that cannot highlight falls back for good.
      if (error instanceof HighlightWorkerUnavailableError) throw error;
      return renderPlainCodeBlock(code, normalizedLang);
    }
  }

  // Unknown or empty language - render as plain code block
  return renderPlainCodeBlock(code, normalizedLang);
}

/**
 * Render a plain code block without syntax highlighting.
 */
function renderPlainCodeBlock(code: string, lang: string): string {
  const escapedCode = escapeHtml(code);
  const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<pre class="shiki"><code${langClass}>${escapedCode}</code></pre>`;
}

/**
 * Render an ANSI-colored code block. The inner renderer already escapes
 * HTML special characters, so we just wrap its output in a matching
 * `<pre class="shiki"><code>` shell for styling parity with shiki.
 */
function renderAnsiBlock(code: string): string {
  const innerHtml = renderAnsiToHtml(code);
  return `<pre class="shiki ansi-block"><code class="language-ansi">${innerHtml}</code></pre>`;
}

/**
 * Render a non-code markdown block with raw HTML disabled and sanitization.
 */
function renderMarkdownBlock(
  block: CompletedBlock,
  safeMarkdownOptions?: SafeMarkdownRenderOptions,
): string {
  return renderSafeMarkdown(block.content, safeMarkdownOptions);
}

/**
 * Render lightweight inline formatting for pending/streaming text.
 * Handles: **bold**, *italic*, `code`, [text](url)
 */
function renderInlineFormatting(text: string): string {
  // Escape HTML first
  let result = escapeHtml(text);

  // Bold: **text**
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic: *text* (but not if it's actually bold marker)
  // Use negative lookbehind/lookahead to avoid matching inside bold
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // Inline code: `text`
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links: [text](url) — handle local file paths and regular URLs
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    if (isLocalFilePath(href)) {
      const ext = getLocalPathExtension(href);
      if (MEDIA_EXTENSIONS.has(ext)) {
        return renderLocalMediaLink(href, label, ext);
      }
      return renderLocalFileLink(href, label, {
        renderMarkdown: ext === "md" || ext === "markdown" || ext === "qmd",
      });
    }
    const safeHref = sanitizeUrl(href);
    if (!safeHref) {
      return `[${label}](${href})`;
    }

    return `<a href="${escapeHtml(safeHref)}">${label}</a>`;
  });

  return result;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
