import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Concrete escape-pattern checks; not a claim to prove arbitrary TS safe. */
export function checkToolDisplaySource(filename, source) {
  const normalized = filename.replaceAll("\\", "/");
  const renderer = /components\/renderers\/tools\/[^/]+Renderer\.tsx$/.test(
    normalized,
  );
  const test = /\/(?:__tests__|__fixtures__)\//.test(normalized);
  const registry = normalized.endsWith("components/renderers/tools/index.tsx");
  const parsed = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations = [];
  const report = (node, reason) =>
    violations.push(
      `${filename}:${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}: ${reason}`,
    );
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const module = node.moduleSpecifier.text.replace(/\.[cm]?[jt]sx?$/, "");
      if (
        !test &&
        !registry &&
        /(?:\/tools\/|^\.\/)[^/]+Renderer$/.test(module) &&
        (renderer || module.includes("/tools/"))
      )
        report(
          node,
          "private renderer import; use checked dispatch or an owned shared helper",
        );
    }
    if (
      !test &&
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(parsed) === "toolRegistry" &&
      ["get", "register"].includes(node.name.text)
    )
      report(node, "raw registry callback access is forbidden");
    if (
      renderer &&
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
    ) {
      const target = node.type.getText(parsed);
      if (
        /^(?:input|result|raw|toolInput|toolResult)$/.test(
          node.expression.getText(parsed),
        ) &&
        ts.isTypeLiteralNode(node.type)
      )
        report(node, "anonymous payload assertion; check consumed fields");
      if (
        /\b(?:\w+(?:Input|Result)(?:WithAugment|WithHtml)?|PreparedToolDisplay|ToolCallbacks)\b/.test(
          target,
        )
      )
        report(
          node,
          "payload assertion into a display type; consume schema output",
        );
    }
    if (
      !test &&
      /\/(?:displayContracts|toolDisplayContracts)\.ts$/.test(normalized) &&
      ts.isCallExpression(node)
    ) {
      const callee = node.expression.getText(parsed);
      if (
        ["z.any", "z.unknown", "z.custom"].includes(callee) ||
        callee.endsWith(".passthrough")
      )
        report(node, "unchecked payload escape in display contract");
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return violations;
}
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(filename)
      : /\.[cm]?tsx?$/.test(filename)
        ? [filename]
        : [];
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const problems = files("packages/client/src").flatMap((file) =>
    checkToolDisplaySource(file, fs.readFileSync(file, "utf8")),
  );
  if (problems.length) {
    process.stderr.write(`${problems.join("\n")}\n`);
    process.exitCode = 1;
  } else
    process.stdout.write(
      "Tool display boundaries: no private imports or payload assertions.\n",
    );
}
