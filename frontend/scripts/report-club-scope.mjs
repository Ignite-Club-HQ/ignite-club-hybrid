#!/usr/bin/env node
// Reports withFeatureBackend call sites without a club scope (3rd argument),
// per feature, using the TypeScript parser. Group routing must not be switched
// on while club-data features have unscoped calls (admin is app-wide).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const root = resolve(import.meta.dirname, '../src');
const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p); } })(root);
const stats = {};
for (const f of files) {
  const src = readFileSync(f, 'utf8'); if (!src.includes('withFeatureBackend(')) continue;
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  (function visit(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'withFeatureBackend') {
      const a0 = n.arguments[0]; const feature = a0 && ts.isStringLiteral(a0) ? a0.text : '(dynamic)';
      stats[feature] ??= { scoped: 0, unscoped: 0 }; stats[feature][n.arguments.length >= 3 ? 'scoped' : 'unscoped']++;
    }
    ts.forEachChild(n, visit);
  })(sf);
}
console.table(stats);
const blocking = Object.entries(stats).filter(([k, v]) => k !== 'admin' && v.unscoped).reduce((n, [, v]) => n + v.unscoped, 0);
console.log(`Unscoped club-data calls: ${blocking}`);
