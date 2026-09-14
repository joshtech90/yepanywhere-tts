/**
 * Registry of per-language renderers for fenced code blocks.
 *
 * The server reduces a fence's info string to one language name and stamps it
 * on the rendered block as `class="language-<name>"`; see
 * `topics/code-fence-renderers.md`. This map is the client half: a language
 * name resolves to the renderer that replaces the highlighted source with
 * something better, or to nothing, which leaves the source alone.
 *
 * Rendering a block costs one lookup here. Registration happens once, at
 * module load in `renderers.ts`, so no block ever triggers discovery work.
 */

export interface CodeFenceRenderer {
  /** Normalized language name, matching the block's `language-*` class. */
  language: string;
  /** What the rendered view is, for the source/render toggle's labels. */
  renderedNoun: string;
  /**
   * Turn block source into markup, or return null to decline.
   *
   * Declining is the normal answer for source that is incomplete or invalid,
   * not an error: a streaming block calls this again as its source grows. The
   * caller leaves the highlighted source in place either way.
   *
   * Output is inserted as markup, so a renderer registered here is asserting
   * the reviewed-renderer trust class in
   * `topics/active-content-security.md` § Sanitized rich-text fragments. Do
   * not register a renderer that has not been reviewed against it.
   */
  render(source: string): Promise<string | null>;
}

const renderers = new Map<string, CodeFenceRenderer>();

export function registerCodeFenceRenderer(renderer: CodeFenceRenderer): void {
  renderers.set(renderer.language, renderer);
}

export function getCodeFenceRenderer(
  language: string,
): CodeFenceRenderer | undefined {
  return renderers.get(language);
}
