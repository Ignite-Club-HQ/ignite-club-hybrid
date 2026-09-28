import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(
  readFileSync(new URL('../exported-test-mapping.json', import.meta.url), 'utf8'),
);

test('maps every authoritative source exactly once', () => {
  assert.equal(manifest.entries.length, 597);
  assert.equal(new Set(manifest.entries.map((entry) => entry.source)).size, 597);
  assert.equal(manifest.entries.filter((entry) => entry.scope === 'non-browser').length, 586);
  assert.equal(manifest.entries.filter((entry) => entry.scope === 'browser-native').length, 11);
});

test('uses exact dispositions and documents the irreducible boundaries', () => {
  const counts = Object.groupBy(manifest.entries, (entry) => entry.disposition);
  assert.equal(counts['direct-retained'].length, 412);
  assert.equal(counts['local-equivalent'].length, 181);
  assert.equal(counts['irreducible-boundary'].length, 4);
  const sources = counts['irreducible-boundary'].map((entry) => entry.source).sort();
  assert.deepEqual(sources, [
    'src/test/androidOsHarness.guard.test.ts',
    'src/test/iosOsHarness.guard.test.ts',
    'tests/ios-os/resume.e2e.mjs',
    'tests/local-supabase/role-surface-access-matrix.test.ts',
  ]);
  const iosEntry = counts['irreducible-boundary'].find(
    (entry) => entry.source === 'tests/ios-os/resume.e2e.mjs',
  );
  assert.match(iosEntry.reason, /iOS device\/simulator/);
  const rlsEntry = counts['irreducible-boundary'].find(
    (entry) => entry.source === 'tests/local-supabase/role-surface-access-matrix.test.ts',
  );
  assert.match(rlsEntry.reason, /club_messages/);
  const iosHarnessEntry = counts['irreducible-boundary'].find(
    (entry) => entry.source === 'src/test/iosOsHarness.guard.test.ts',
  );
  assert.match(iosHarnessEntry.reason, /codemagic\.yaml/);
  const androidHarnessEntry = counts['irreducible-boundary'].find(
    (entry) => entry.source === 'src/test/androidOsHarness.guard.test.ts',
  );
  assert.match(androidHarnessEntry.reason, /codemagic\.yaml/);
});
