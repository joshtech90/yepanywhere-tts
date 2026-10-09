/**
 * Shiki highlighting worker.
 *
 * Owns the process's only Shiki highlighter, its grammars, and its Oniguruma
 * WebAssembly instance. WebAssembly memory grows with grammars and input and
 * never shrinks, so the main thread recycles this worker (see
 * `highlight-worker-host.ts`) instead of letting the high-water mark live for
 * the whole server process.
 *
 * Plain JavaScript so it runs unchanged from `src` under tsx and from `dist`
 * without a TypeScript loader in the worker.
 *
 * Request: `{ id, code, lang, codeClass? }`. Reply: `{ id, html }` or
 * `{ id, error }`, each with this isolate's `externalBytes`.
 */

import { parentPort } from "node:worker_threads";
import { bundledLanguages, createHighlighter } from "shiki";
import { addClassToHast, createCssVariablesTheme } from "shiki/core";

/** CSS variables theme - outputs `style="color: var(--shiki-...)"` */
const cssVarsTheme = createCssVariablesTheme({
  name: "css-variables",
  variablePrefix: "--shiki-",
  fontStyle: true,
});

let highlighterPromise;
const loadedLanguages = new Set();

function getHighlighter() {
  highlighterPromise ??= createHighlighter({
    themes: [cssVarsTheme],
    langs: [],
  });
  return highlighterPromise;
}

async function highlight({ code, lang, codeClass }) {
  if (!(lang in bundledLanguages)) {
    throw new Error(`Unsupported language: ${lang}`);
  }
  const highlighter = await getHighlighter();
  if (!loadedLanguages.has(lang)) {
    await highlighter.loadLanguage(lang);
    loadedLanguages.add(lang);
  }
  return highlighter.codeToHtml(code, {
    lang,
    theme: "css-variables",
    transformers: codeClass
      ? [
          {
            code(node) {
              addClassToHast(node, codeClass);
            },
          },
        ]
      : [],
  });
}

// Jobs run one at a time in arrival order. Highlighting is synchronous once
// the grammar is loaded, so queueing only matters across grammar loads.
let tail = Promise.resolve();

parentPort?.on("message", (request) => {
  tail = tail.then(async () => {
    try {
      const html = await highlight(request);
      parentPort?.postMessage({
        id: request.id,
        html,
        externalBytes: process.memoryUsage().external,
      });
    } catch (error) {
      parentPort?.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
        externalBytes: process.memoryUsage().external,
      });
    }
  });
});
