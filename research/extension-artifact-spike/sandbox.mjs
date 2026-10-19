// Bundled into the isolated packaged sandbox. Parsers are existing pinned
// development dependencies; this is explicitly not a production dependency choice.
import * as css from "../../node_modules/.pnpm/css-tree@3.2.1/node_modules/css-tree/lib/index.js";
import { parse } from "../../node_modules/.pnpm/es-module-lexer@2.3.2/node_modules/es-module-lexer/dist/lexer.asm.js";

let hostPort;
let nextId = 0;
const pending = new Map();
const objects = new Map();
const building = new Set();
let current;
let widgetState = null;
const decoder = new TextDecoder();
const encodeScript = (value) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");
function rpc(type, payload) {
  if (pending.size >= 32)
    return Promise.reject(new Error("Too many pending requests"));
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Viewer request timed out"));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    hostPort.postMessage({ id, type, ...payload });
  });
}
function pathFor(reference, from) {
  const url = new URL(reference, `file://${from}`);
  if (url.protocol !== "file:" || url.host || url.search)
    throw new Error(
      "Only granted local file paths without queries are supported",
    );
  return decodeURIComponent(url.pathname);
}
async function read(path) {
  return rpc("read", { path });
}
function object(bytes, mime) {
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
async function stylesheet(text, from) {
  const tree = css.parse(text);
  const updates = [];
  css.walk(tree, (node) => {
    if (node.type === "Url" && !node.value.startsWith("data:"))
      updates.push([node, node.value]);
    if (node.type === "Atrule" && node.name === "import")
      throw new Error("CSS @import is unsupported in this first adapter");
  });
  // Sequential work bounds request concurrency for the research host.
  for (const [node, value] of updates) node.value = await asset(value, from);
  return css.generate(tree);
}
async function javascript(text, from) {
  const [imports] = parse(text);
  const edits = [];
  for (const item of imports) {
    if (item.d === -2)
      throw new Error("import.meta is unsupported in this first adapter");
    if (!item.n)
      throw new Error(
        "Computed dynamic import is unsupported in this first adapter",
      );
    const url = await asset(item.n, from, "module");
    edits.push({
      start: item.s,
      end: item.e,
      value: item.d >= 0 ? JSON.stringify(url) : url,
    });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
  return text;
}
async function asset(reference, from, kind) {
  if (reference.startsWith("data:")) return reference;
  const path = pathFor(reference, from);
  const key = `${kind ?? "asset"}:${path}`;
  if (objects.has(key)) return objects.get(key);
  if (building.has(key))
    throw new Error(
      "Cyclic asset/module graph is unsupported in this first adapter",
    );
  building.add(key);
  try {
    const result = await read(path);
    let body = result.bytes;
    let mime = result.mime;
    if (kind === "css") {
      body = await stylesheet(decoder.decode(body), path);
      mime = "text/css";
    }
    if (kind === "module") {
      body = await javascript(decoder.decode(body), path);
      mime = "text/javascript";
    }
    const url = object(body, mime);
    objects.set(key, url);
    return url;
  } finally {
    building.delete(key);
  }
}
async function render(path) {
  current = path;
  for (const url of objects.values()) URL.revokeObjectURL(url);
  objects.clear();
  try {
    const { bytes } = await read(path);
    const doc = new DOMParser().parseFromString(
      decoder.decode(bytes),
      "text/html",
    );
    doc
      .querySelectorAll("base, meta[http-equiv], iframe, object, embed")
      .forEach((e) => {
        e.remove();
      });
    for (const link of doc.querySelectorAll('link[rel="stylesheet"][href]'))
      link.setAttribute(
        "href",
        await asset(link.getAttribute("href"), path, "css"),
      );
    for (const style of doc.querySelectorAll("style"))
      style.textContent = await stylesheet(style.textContent, path);
    for (const element of doc.querySelectorAll("[style]")) {
      const declarations = element.getAttribute("style");
      const transformed = await stylesheet(`x{${declarations}}`, path);
      element.setAttribute(
        "style",
        transformed.slice(transformed.indexOf("{") + 1, -1),
      );
    }
    for (const image of doc.querySelectorAll(
      "img[src], source[src], video[poster]",
    )) {
      const attr = image.hasAttribute("poster") ? "poster" : "src";
      image.setAttribute(attr, await asset(image.getAttribute(attr), path));
    }
    if (doc.querySelector("[srcset]"))
      throw new Error("srcset is unsupported in this first adapter");
    for (const script of doc.querySelectorAll("script")) {
      if (
        script.type &&
        !["module", "text/javascript", "application/javascript"].includes(
          script.type,
        )
      )
        continue;
      const module = script.type === "module";
      let source = script.textContent;
      let from = path;
      if (script.hasAttribute("src")) {
        from = pathFor(script.getAttribute("src"), path);
        source = decoder.decode((await read(from)).bytes);
        script.removeAttribute("src");
      }
      if (module) source = await javascript(source, from);
      // Use a script URL to avoid HTML parser end-tag handling in arbitrary JS.
      script.textContent = "";
      script.src = object(source, "text/javascript");
      objects.set(`script:${objects.size}`, script.src);
      if (!module) script.async = false;
    }
    const bridge = doc.createElement("script");
    bridge.textContent = `window.openai={theme:'light',widgetState:${encodeScript(widgetState)},setWidgetState(s){window.__yaSpike.state(s)},sendFollowUpMessage({prompt}){return window.__yaSpike.followup(prompt)}};window.__theme='light';window.sendFollowUpMessage=(s)=>window.__yaSpike.followup(typeof s==='string'?s:s.prompt);window.fetch=(input,init)=>window.__yaSpike.fetch(input,init);addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a||a.getAttribute('href').startsWith('#'))return;e.preventDefault();window.__yaSpike.navigate(a.getAttribute('href'))});`;
    doc.head.prepend(bridge);
    document.open();
    document.write(`<!doctype html>${doc.documentElement.outerHTML}`);
    document.close();
  } catch (error) {
    document.body.textContent = `Extension artifact spike: ${error}`;
    hostPort.postMessage({ type: "status", text: String(error) });
  }
}
window.__yaSpike = {
  state(value) {
    if (JSON.stringify(value).length > 16000)
      throw new Error("Widget state too large");
    widgetState = value;
    window.openai.widgetState = value;
    void rpc("state", { value });
  },
  followup(text) {
    return rpc("followup", { text });
  },
  async fetch(input, init) {
    if (init?.method && init.method !== "GET") throw new Error("Read only");
    const path = pathFor(
      typeof input === "string" ? input : input.url,
      current,
    );
    const { bytes, mime } = await read(path);
    return new Response(bytes, { headers: { "content-type": mime } });
  },
  navigate(reference) {
    return rpc("navigate", { path: pathFor(reference, current) });
  },
};
addEventListener("message", function connect(event) {
  if (
    event.source !== parent ||
    event.data?.type !== "ya-spike-init" ||
    hostPort ||
    !event.ports[0]
  )
    return;
  hostPort = event.ports[0];
  widgetState = event.data.widgetState ?? null;
  hostPort.onmessage = (event) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    clearTimeout(request.timer);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data);
  };
  void render(event.data.entry);
});
parent.postMessage({ type: "ya-spike-ready" }, "*");
