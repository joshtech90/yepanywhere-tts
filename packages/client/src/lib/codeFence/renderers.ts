/**
 * The registered code-fence renderers, in one place.
 *
 * Registration is explicit so that adding a language is a visible diff here
 * and nowhere else. Each entry asserts the reviewed-renderer trust class
 * described on `CodeFenceRenderer.render`; read that before adding one.
 */

import { mermaidRenderer } from "./mermaidRenderer";
import { registerCodeFenceRenderer } from "./registry";

registerCodeFenceRenderer(mermaidRenderer);

export { type CodeFenceRenderer, getCodeFenceRenderer } from "./registry";
