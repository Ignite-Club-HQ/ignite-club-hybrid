/**
 * Local equivalent of the exported `edgeFunctionEstateValidation.test.ts` estate
 * sweep. It reproduces the same source-only, non-executing validation — every
 * sanitized Edge Function under `reference/backend/supabase/functions` must
 * parse and every relative import must resolve — against the inert reference
 * copies instead of a live `supabase/functions` tree. It never starts
 * Supabase, reads environment credentials, or contacts Deno/esm.sh imports;
 * `reference/backend` is only ever read as text here, never executed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const functionsRoot = path.resolve(__dirname, '../../reference/backend/supabase/functions');

function extractSanitizedSource(mdText: string): string {
  const lines = mdText.split('\n');
  const openIndex = lines.findIndex((line) => /^`{4,}/.test(line));
  if (openIndex === -1) throw new Error('Missing fenced source block in reference markdown');
  const closeIndex = lines.findIndex(
    (line, index) => index > openIndex && /^`{4,}\s*$/.test(line),
  );
  if (closeIndex === -1) throw new Error('Unterminated fenced source block in reference markdown');
  return lines.slice(openIndex + 1, closeIndex).join('\n');
}

const entryPoints = readdirSync(functionsRoot, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory()
      && !entry.name.startsWith('_')
      && existsSync(path.join(functionsRoot, entry.name, 'index.ts.md')),
  )
  .map((entry) => ({
    name: entry.name,
    file: path.join(functionsRoot, entry.name, 'index.ts.md'),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

function localImports(source: string): string[] {
  return [
    ...source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g),
  ].map((match) => match[1]);
}

function resolveLocalImport(importerMdFile: string, specifier: string): string | null {
  // Sanitized references are stored as `<original path>.md`; the exported
  // source always uses explicit extensions, so the reference sibling is the
  // same specifier with `.md` appended.
  const candidate = path.resolve(path.dirname(importerMdFile), `${specifier}.md`);
  return existsSync(candidate) ? candidate : null;
}

describe('Edge Function estate deployability (reference/backend, local)', () => {
  it('discovers the complete non-shared Edge Function estate', () => {
    // Mirrors the exported estate-wide floor; a sudden drop normally means
    // functions were moved or omitted from the sanitized reference export.
    expect(entryPoints.length).toBeGreaterThanOrEqual(116);
  });

  it.each(entryPoints)('$name parses without syntax or duplicate-declaration errors', ({ file }) => {
    const source = extractSanitizedSource(readFileSync(file, 'utf8'));
    expect(() =>
      parse(source, {
        sourceType: 'module',
        sourceFilename: path.relative(functionsRoot, file),
        plugins: ['typescript', 'jsx', 'importAttributes'],
      }),
    ).not.toThrow();
  });

  it.each(entryPoints)('$name has no broken relative imports', ({ file }) => {
    const source = extractSanitizedSource(readFileSync(file, 'utf8'));
    for (const specifier of localImports(source)) {
      expect(
        resolveLocalImport(file, specifier),
        `${path.relative(functionsRoot, file)} imports missing local reference module ${specifier}`,
      ).not.toBeNull();
    }
  });
});
