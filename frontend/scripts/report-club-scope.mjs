#!/usr/bin/env node
// Reports withFeatureBackend call sites without a club scope (3rd argument),
// per feature. Group routing must not be switched on while club-data features
// have unscoped calls (admin is app-wide and exempt).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../src');
const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p); } })(root);
const stats = {};
for (const f of files) {
  const src = readFileSync(f, 'utf8'); let i = 0;
  while ((i = src.indexOf('withFeatureBackend(', i)) !== -1) {
    let j = i + 19, depth = 1, commas = 0, str = null;
    for (; j < src.length && depth; j++) {
      const c = src[j];
      if (str) { if (c === '\\') j++; else if (c === str) str = null; continue; }
      if (c === '"' || c === "'" || c === '`') str = c;
      else if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 1) commas++;
    }
    const feature = (src.slice(i + 19, i + 60).match(/^\s*["'](\w+)["']/) ?? [])[1] ?? '(dynamic)';
    const scoped = commas >= 2 && !/,\s*\)$/.test(src.slice(i, j).replace(/,\s*\)$/, ')').slice(-3)) && commas >= 2;
    stats[feature] ??= { scoped: 0, unscoped: 0 }; stats[feature][scoped ? 'scoped' : 'unscoped']++;
    i = j;
  }
}
console.table(stats);
const blocking = Object.entries(stats).filter(([k, v]) => k !== 'admin' && v.unscoped).reduce((n, [, v]) => n + v.unscoped, 0);
console.log(`Unscoped club-data calls: ${blocking}`);
