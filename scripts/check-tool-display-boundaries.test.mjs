import assert from "node:assert/strict";
import { test } from "node:test";
import { checkToolDisplaySource } from "./check-tool-display-boundaries.mjs";
const renderer =
  "packages/client/src/components/renderers/tools/ProbeRenderer.tsx";
const caller = "packages/client/src/components/Probe.tsx";
for (const [name, file, source] of [
  [
    "private import",
    caller,
    'import {writeRenderer} from "./renderers/tools/WriteRenderer";',
  ],
  [
    "private import with extension",
    caller,
    'export {writeRenderer} from "./renderers/tools/WriteRenderer.js";',
  ],
  [
    "anonymous payload assertion",
    renderer,
    "const value = result as { content: string };",
  ],
  [
    "raw retrieval",
    caller,
    'toolRegistry.get("Write").renderToolUse(raw,context);',
  ],
  ["legacy registration", caller, "toolRegistry.register(rawCallbacks);"],
  ["raw payload assertion", renderer, "const input = raw as WriteInput;"],
  [
    "double assertion",
    renderer,
    "const result = raw as unknown as ReadResult;",
  ],
  [
    "unchecked schema",
    "packages/client/src/components/renderers/tools/displayContracts.ts",
    "const contract=z.unknown();",
  ],
])
  test(`rejects ${name}`, () =>
    assert.equal(checkToolDisplaySource(file, source).length, 1));
test("permits checked calls, DOM assertions and CSS modules", () => {
  assert.deepEqual(
    checkToolDisplaySource(
      caller,
      'toolRegistry.prepare("Write",record).renderToolUse(context);',
    ),
    [],
  );
  assert.deepEqual(
    checkToolDisplaySource(
      renderer,
      'import styles from "./WriteRenderer.module.css"; const element = target as HTMLElement;',
    ),
    [],
  );
});
