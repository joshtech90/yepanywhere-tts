// Load the installed ESM dependency graph directly; Bun's Vitest VM loader is
// not equivalent to its production module loader (see the runtime test gap).
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { renderSafeMarkdown } = await import(
  pathToFileURL(resolve(process.argv[2], "dist/augments/safe-markdown.js")).href
);
const math = renderSafeMarkdown(
  "Inline $x^2$ and display:\n\n$$\\frac{1}{2}$$",
);
assert.match(math, /class="katex"/);
assert.match(math, /class="katex-display"/);
assert.doesNotMatch(math, /yepkatex-placeholder/);
const html = renderSafeMarkdown(
  '<textarea></textarea/><img src=x onerror="alert(1)"><script>alert(1)</script>',
);
assert.doesNotMatch(html, /<(?:textarea|script)\b|\son\w+\s*=/i);
console.log(
  `Installed renderer contract passed (${process.versions.bun ? "Bun" : "Node"})`,
);
