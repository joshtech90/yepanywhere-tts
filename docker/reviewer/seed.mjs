// Feed {username,password,relayUrl} on stdin; never put credentials in arguments.
// Run once in an empty /demo volume, with no network access.
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { RemoteAccessService } from "./dist/remote-access/RemoteAccessService.js";
import { InstallService } from "./dist/services/InstallService.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const credential = JSON.parse(input);
const dataDir = "/demo/data";
if (
  await access(join(dataDir, "install.json")).then(
    () => true,
    () => false,
  )
) {
  throw new Error("Refusing to reseed an existing reviewer installation");
}
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const install = new InstallService({ dataDir });
await install.initialize();
await install.recordSuccessfulProviders(["claude"]);
const remote = new RemoteAccessService({ dataDir });
await remote.initialize();
await remote.setRelayConfig({
  username: credential.username,
  url: credential.relayUrl,
});
await remote.configure(credential.password);
await remote.waitForPendingWrites();

const projects = [
  {
    name: "weather-dashboard",
    prompt: "Create a simple weather dashboard with an accessible city search.",
    answer:
      "The sample dashboard is ready. It has a city search, a seven-day forecast, and keyboard navigation.\n\nThis is a synthetic demo conversation; the mock provider does not call an AI service.",
    file: "export const forecast = [{ day: 'Monday', degrees: 21, sky: 'Sunny' }];\n",
  },
  {
    name: "recipe-notebook",
    prompt: "Add recipe tags and explain how to test the filter.",
    answer:
      "Added vegetarian, quick, and baking tags. Select a tag to filter the sample recipes, then clear it to show the full list.\n\n```js\nconst visible = recipes.filter(recipe => recipe.tags.includes(selectedTag));\n```\n\nAll data in this reviewer server is fictional.",
    file: "export const recipes = [{ name: 'Garden pasta', tags: ['vegetarian', 'quick'] }];\n",
  },
];
for (const project of projects) {
  const cwd = join("/demo/projects", project.name);
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(cwd, "README.md"),
    `# ${project.name}\n\nSynthetic Yep Anywhere reviewer project. No personal data or provider credentials.\n`,
  );
  await writeFile(join(cwd, "sample.js"), project.file);
  execFileSync("git", ["init", "--quiet", cwd]);
  const sessionId = randomUUID();
  const transcript = join(
    "/demo/home/.claude/projects",
    hostname(),
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    `${sessionId}.jsonl`,
  );
  await mkdir(dirname(transcript), { recursive: true });
  const rows = [project.prompt, project.answer].map((text, index) => ({
    type: index ? "assistant" : "user",
    uuid: `${sessionId}-${index}`,
    parentUuid: index ? `${sessionId}-0` : null,
    sessionId,
    cwd,
    timestamp: new Date(Date.now() - (2 - index) * 60000).toISOString(),
    message: {
      role: index ? "assistant" : "user",
      content: [{ type: "text", text }],
    },
  }));
  await writeFile(
    transcript,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}
console.log("Synthetic reviewer projects and relay verifier initialized.");
