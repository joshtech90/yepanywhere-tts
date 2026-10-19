import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
const require = createRequire(
  new URL("../../packages/client/package.json", import.meta.url),
);
export function chart(seed = 0) {
  const w = 640,
    h = 180,
    data = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const line =
        Math.abs(y - (110 - 44 * Math.sin((x + seed * 11) / 70) - x / 18)) < 3;
      const grid = x % 80 === 0 || y % 45 === 0;
      data.set(
        line
          ? [25 + ((seed * 7) % 150), 127, 104, 255]
          : grid
            ? [215, 228, 225, 255]
            : [245, 250, 248, 255],
        y * (w * 4 + 1) + 1 + x * 4,
      );
    }
  const chunk = (type, bytes) => {
    const body = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const value of body) {
      crc ^= value;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4),
      check = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(data)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export const files = {
  "report/index.html": [
    "text/html",
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Native resource loading</title><link rel="stylesheet" href="style.css"><main><p class="tag">Service worker · local files</p><h1>HTML and its assets, unchanged</h1><p>This page uses ordinary relative URLs. The content host supplies only a bootstrap and worker; Yep supplies the document and assets.</p><img id="chart" alt="Locally referenced PNG chart" src="../assets/chart.png" srcset="../assets/chart.png 1x"><div class="card"><label for="note">Try the live document</label><p><input id="note" placeholder="Type a note"></p><button id="counter">Explore · <span id="count">0</span></button><p id="modules">Loading modules…</p><span id="tick"></span></div><a id="next" href="page2.html">Open linked document →</a></main><script src="classic.js"></script><script type="module" src="app.js"></script>`,
  ],
  "report/style.css": [
    "text/css",
    `@import "more.css";@font-face{font-family:ArtifactFont;src:url('../assets/font.woff2')}*{box-sizing:border-box}body{margin:0;padding:20px;background:#f8faf9;color:#15382d;font:15px system-ui}main{max-width:740px;margin:auto}h1{font-size:25px;margin:10px 0}p{line-height:1.45}img{display:block;width:100%;border:1px solid #d8e6df;border-radius:10px}.tag{font:12px ArtifactFont,monospace;color:#376d5b;text-transform:uppercase}.card{background-color:white;border:1px solid #d8e6df;border-radius:10px;padding:12px;margin:12px 0}input{background:white;color:#15382d;width:100%;padding:10px;font:inherit;border:1px solid #b9ccc5;border-radius:6px}button{padding:10px 14px;font:inherit;background:#176b51;color:white;border:0;border-radius:6px}#modules,#tick{font:12px ArtifactFont,monospace}#tick{display:none}a{color:#176b51}@media(max-width:440px){body{padding:12px}h1{font-size:22px}}`,
  ],
  "report/more.css": [
    "text/css",
    `.tag{letter-spacing:0.5px}.card{background-image:url('../assets/dot.svg');background-repeat:no-repeat;background-position:right top}`,
  ],
  "report/classic.js": [
    "text/javascript",
    `window.classicLoaded=true;document.querySelector('#counter').onclick=()=>document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);setInterval(()=>document.querySelector('#tick').textContent=String(Date.now()),80);`,
  ],
  "report/app.js": [
    "text/javascript",
    `import {label} from './lib.js';const suffix='dyn.js';const dynamic=await import('./'+suffix);const data=await(await fetch('data.json')).json();window.result={label,dynamic:dynamic.label,data};document.querySelector('#modules').textContent='Static + computed dynamic import + JSON: '+data.notes+' notes';`,
  ],
  "report/lib.js": ["text/javascript", `export const label='static';`],
  "report/dyn.js": [
    "text/javascript",
    `export const label='computed dynamic';`,
  ],
  "report/data.json": ["application/json", '{"notes":3}'],
  "report/page2.html": [
    "text/html",
    `<!doctype html><link rel="stylesheet" href="style.css"><main><h1>Linked page</h1><img alt="Same local chart" src="../assets/chart.png"><p>Native document navigation, under the same worker.</p><a href="index.html">Back to report</a><script>fetch('data.json').then(r=>r.json()).then(v=>window.page2=v.notes)</script></main>`,
  ],
  "report/slow.bin": [
    "application/octet-stream",
    Buffer.alloc(4 * 1024 * 1024, 7),
  ],
  "assets/chart.png": ["image/png", chart()],
  "assets/dot.svg": [
    "image/svg+xml",
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="4" fill="#197f68"/></svg>',
  ],
  "assets/font.woff2": [
    "font/woff2",
    readFileSync(
      require.resolve("katex/dist/fonts/KaTeX_Typewriter-Regular.woff2"),
    ),
  ],
};
