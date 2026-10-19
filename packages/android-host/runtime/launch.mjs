import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostProfile, initializeProfile } from "./profile.mjs";

const home = process.env.HOME;
if (!home || home === "/")
  throw new Error("Explicit app-private HOME required");
mkdirSync(home, { recursive: true, mode: 0o700 });
let development = {};
try {
  development = JSON.parse(
    readFileSync(join(home, "development.json"), "utf8"),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const profile = hostProfile(
  home,
  development,
  Number(process.env.YEP_ANDROID_HOST_PORT ?? 13400),
);
initializeProfile(profile);
const tokenFile = join(home, ".local-access-token");
try {
  writeFileSync(tokenFile, randomBytes(32).toString("base64url"), {
    flag: "wx",
    mode: 0o600,
  });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
const token = readFileSync(tokenFile, "utf8").trim();
if (!/^[A-Za-z0-9_-]{43}$/.test(token))
  throw new Error("Invalid local access credential");
Object.assign(process.env, profile.env, { DESKTOP_AUTH_TOKEN: token });
// Do not inherit workstation provider homes, tokens, relay settings or login.
process.chdir(home);
console.log(
  `YA Android host: ${profile.mode}; external sessions disabled; loopback only`,
);
await import("/opt/yep/dist/index.js");
