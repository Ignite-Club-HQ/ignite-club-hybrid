/**
 * Dead-import codemod.
 *
 * Removes import bindings that the TypeScript compiler proves are never read.
 *
 * Safety model:
 *  - Only ImportDeclaration specifiers are touched. Local variables, parameters
 *    and other unused symbols are left alone, because deleting those can drop a
 *    side-effecting initializer.
 *  - By default only *partial* removals are applied: at least one binding must
 *    survive in each declaration, so the module is still imported and any
 *    import side effects are preserved byte-for-byte.
 *  - `--allow-empty` additionally deletes declarations whose bindings are all
 *    unused. That changes the module graph, so it is opt-in and must be
 *    reviewed against the product build.
 *  - Identifiers asserted by the `lab-tests/**` characterization guards are
 *    never removed. Those guards inspect page source text, so a mechanical
 *    cleanup must not be able to silently weaken a safety contract.
 *
 * Usage:
 *   node scripts/remove-dead-imports.mjs            # report only
 *   node scripts/remove-dead-imports.mjs --write    # apply safe partial removals
 */

import ts from "typescript";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const write = process.argv.includes("--write");
const allowEmpty = process.argv.includes("--allow-empty");

/**
 * Collects every identifier that a lab guard test asserts on via
 * `toContain("...")`. Those strings are matched against page source, so the
 * symbol must stay in the file even when it is otherwise unreferenced.
 */
function collectGuardedIdentifiers(directory) {
  const guarded = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs)$/.test(entry)) continue;
      const text = readFileSync(full, "utf8");
      for (const match of text.matchAll(/toContain\(\s*["'`]([A-Za-z_$][\w$]*)["'`]\s*\)/g)) {
        guarded.add(match[1]);
      }
    }
  };
  try {
    walk(directory);
  } catch {
    // no lab-tests directory: nothing to protect
  }
  return guarded;
}

const guardedIdentifiers = collectGuardedIdentifiers(resolve(root, "lab-tests"));

const configPath = resolve(root, "tsconfig.app.json");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);

const program = ts.createProgram(parsed.fileNames, {
  ...parsed.options,
  noUnusedLocals: true,
  noEmit: true,
});

const unusedByFile = new Map();
for (const diagnostic of program.getSemanticDiagnostics()) {
  // 6133: declared but never read. 6196/6192 handled via the same node walk.
  if (diagnostic.code !== 6133 && diagnostic.code !== 6196 && diagnostic.code !== 6192) continue;
  if (!diagnostic.file || diagnostic.start === undefined) continue;
  const file = diagnostic.file.fileName;
  if (!unusedByFile.has(file)) unusedByFile.set(file, []);
  unusedByFile.get(file).push(diagnostic.start);
}

let filesChanged = 0;
let bindingsRemoved = 0;
let declarationsSkipped = 0;
let guardProtected = 0;

for (const [fileName, positions] of unusedByFile) {
  const source = program.getSourceFile(fileName);
  if (!source || source.isDeclarationFile) continue;

  const positionSet = new Set(positions);
  /** @type {{statement: ts.ImportDeclaration, keepDefault: boolean, keep: ts.ImportSpecifier[], removed: number}[]} */
  const rewrites = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    const named = clause.namedBindings;

    if (named && ts.isNamespaceImport(named)) continue; // namespace imports: leave alone

    const isUnused = (node) => {
      if (!positionSet.has(node.name.getStart(source))) return false;
      if (guardedIdentifiers.has(node.name.text)) {
        guardProtected += 1;
        return false;
      }
      return true;
    };

    const defaultUnused = clause.name ? isUnused(clause) : false;
    const elements = named && ts.isNamedImports(named) ? named.elements : [];
    const keep = elements.filter((element) => !isUnused(element));
    const removed = elements.length - keep.length + (defaultUnused ? 1 : 0);
    if (removed === 0) continue;

    if (keep.length === 0 && (defaultUnused || !clause.name)) {
      // Whole declaration is dead: deleting it would stop loading the module.
      if (!allowEmpty) {
        declarationsSkipped += 1;
        continue;
      }
    }

    rewrites.push({ statement, keepDefault: !!clause.name && !defaultUnused, keep, removed });
  }

  if (rewrites.length === 0) continue;
  filesChanged += 1;
  bindingsRemoved += rewrites.reduce((sum, rewrite) => sum + rewrite.removed, 0);

  if (!write) continue;

  let text = source.text;
  // Apply from the end so earlier offsets stay valid.
  for (const rewrite of [...rewrites].reverse()) {
    const { statement, keepDefault, keep } = rewrite;
    const start = statement.getStart(source);
    const end = statement.getEnd();
    const moduleSpecifier = statement.moduleSpecifier.getText(source);
    const original = text.slice(start, end);
    const isTypeOnly = statement.importClause?.isTypeOnly ? "type " : "";

    if (!keepDefault && keep.length === 0) {
      // Remove the whole declaration plus its trailing newline.
      let cut = end;
      if (text[cut] === "\r") cut += 1;
      if (text[cut] === "\n") cut += 1;
      text = text.slice(0, start) + text.slice(cut);
      continue;
    }

    const defaultName = keepDefault ? statement.importClause.name.getText(source) : "";
    const namedText = keep.length > 0 ? `{ ${keep.map((k) => k.getText(source)).join(", ")} }` : "";
    const clauseText = [defaultName, namedText].filter(Boolean).join(", ");
    const singleLine = `import ${isTypeOnly}${clauseText} from ${moduleSpecifier};`;

    // Preserve the declaration's original shape: only keep a multi-line list if
    // the source already used one. Reflowing single-line imports would add
    // lines back and work against the duplication/bloat goal.
    const wasMultiLine = original.includes("\n");
    let replacement = singleLine;
    if (wasMultiLine && keep.length > 1) {
      const body = keep.map((k) => `  ${k.getText(source)},`).join("\n");
      const lead = defaultName ? `${defaultName}, ` : "";
      replacement = `import ${isTypeOnly}${lead}{\n${body}\n} from ${moduleSpecifier};`;
    }

    if (replacement !== original) {
      text = text.slice(0, start) + replacement + text.slice(end);
    }
  }

  writeFileSync(fileName, text);
}

console.log(
  JSON.stringify(
    {
      mode: write ? "write" : "report",
      allowEmpty,
      filesChanged,
      bindingsRemoved,
      wholeDeclarationsSkipped: declarationsSkipped,
      guardProtectedBindings: guardProtected,
    },
    null,
    2,
  ),
);
