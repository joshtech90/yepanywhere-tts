import { mkdir, writeFile } from "node:fs/promises";
import { loadShellAssets } from "./assets.mjs";
const root = new URL("./", import.meta.url);
const assets = await loadShellAssets();
await mkdir(new URL(".generated/", root), { recursive: true });
await writeFile(
  new URL(".generated/index.mjs", root),
  `import { serve } from "../host.mjs";\nconst assets = ${JSON.stringify(assets)};\nexport default { fetch(request, env) { return serve(request, assets, env); } };\n`,
);
