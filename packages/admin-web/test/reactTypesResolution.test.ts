// Guards CI against the 2026-10-05 flake (run 37262880583: 1366 × TS2786 on a
// docs-only commit whose identical tree had passed the day before).
//
// pnpm 9 orders workspace projects by how fast each one's .npmrc read finishes,
// and the first project to declare an alias wins node_modules/.pnpm/node_modules.
// That directory holds admin-web's @types/react 18 on most installs and mobile's
// 19 on the rest. Typings that import "react" without declaring @types/react
// (lucide-react, recharts, react-router) resolve through it. tsconfig "paths"
// pins them to our own copy. Without the pin this test fails on every install,
// not only on the unlucky ones.
import { describe, it, expect } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hiddenHoist = /[\\/]node_modules[\\/]\.pnpm[\\/]node_modules[\\/]/;
const typesReactDir = /^(.*[\\/]@types[\\/]react)[\\/]/;

function packageOf(file: string): string {
  const m =
    /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(
      file,
    );
  return m?.[1] ?? path.relative(root, file);
}

function reactSpecifiers(sf: ts.SourceFile): ts.StringLiteral[] {
  const found: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    let lit: ts.Expression | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) lit = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      lit = node.argument.literal;
    else if (ts.isExternalModuleReference(node)) lit = node.expression;
    if (lit && ts.isStringLiteral(lit) && (lit.text === "react" || lit.text.startsWith("react/")))
      found.push(lit);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("React types resolution", () => {
  it("compiles against admin-web's own @types/react, never pnpm's hidden hoist", () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      path.join(root, "tsconfig.json"),
      undefined,
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
        },
      },
    );
    if (!parsed) throw new Error("admin-web tsconfig.json did not parse");
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });

    // Every "react" import in the program, ours and every library's typings.
    const offenders = new Map<string, number>();
    for (const sf of program.getSourceFiles()) {
      for (const lit of reactSpecifiers(sf)) {
        const { resolvedModule } = ts.resolveModuleName(
          lit.text,
          sf.fileName,
          parsed.options,
          ts.sys,
          undefined,
          undefined,
          program.getModeForUsageLocation(sf, lit),
        );
        const via = resolvedModule?.originalPath ?? resolvedModule?.resolvedFileName;
        if (via === undefined || hiddenHoist.test(via)) {
          const key = `${packageOf(sf.fileName)} → "${lit.text}" ${via === undefined ? "unresolved" : "via pnpm's hidden hoist"}`;
          offenders.set(key, (offenders.get(key) ?? 0) + 1);
        }
      }
    }
    expect([...offenders].map(([k, n]) => `${k} (${n}×)`).sort()).toEqual([]);

    // One React type universe: only admin-web's own @types/react is loaded.
    const loaded = new Set(
      program
        .getSourceFiles()
        .map((f) => typesReactDir.exec(f.fileName)?.[1])
        .filter((dir): dir is string => dir !== undefined),
    );
    expect([...loaded]).toEqual([fs.realpathSync(path.join(root, "node_modules/@types/react"))]);
  }, 120_000);
});
