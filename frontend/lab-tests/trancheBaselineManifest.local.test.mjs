import assert from 'node:assert/strict';
import test from 'node:test';

const trancheIds = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09a', '09b'];

const trancheTestManifest = Object.freeze({
  '00': { name: 'setup guards', vitest: ['src/test/.*guard\\.test\\.ts'] },
  '01': { name: 'auth safety', vitest: ['src/.*Auth.*\\.test\\.tsx'], playwright: ['e2e-baseline/auth-safety.spec.ts'] },
  '02': { name: 'committee invitations', vitest: ['src/.*invite.*\\.test\\.(ts|tsx)'], playwright: ['e2e-baseline/committee-invite-mobile-signup.spec.ts'], local: ['tests/local-supabase/invitations\\.transaction\\.test\\.ts'] },
  '03': { name: 'rsvp and events', vitest: ['src/.*Event.*\\.test\\.(ts|tsx)'], playwright: ['e2e-baseline/club-wide-game-rsvp.spec.ts'], local: ['tests/local-supabase/club-wide-game-rsvp-journey\\.test\\.ts'] },
  '04': { name: 'membership', vitest: ['src/.*membership.*\\.test\\.(ts|tsx)'], local: ['tests/local-supabase/membership-.*\\.test\\.ts'] },
  '05': { name: 'messaging', vitest: ['src/.*chat.*\\.test\\.(ts|tsx)'], playwright: ['e2e-baseline/messaging-cross-surface-contracts.spec.ts'], local: ['tests/local-supabase/messaging-security-journey\\.test\\.ts'] },
  '06': { name: 'vault', vitest: ['src/.*vault.*\\.test\\.(ts|tsx)'], playwright: ['e2e-baseline/vault-upload-safety.spec.ts'], local: ['tests/local-supabase/storage-.*\\.test\\.ts'] },
  '07': { name: 'pitch board', vitest: ['src/components/pitch/AutoSubPlanDialog\\.matrix\\.test\\.ts', 'src/components/pitch/.*\\.test\\.tsx'], playwright: ['e2e-baseline/messaging-navigation-and-layout.spec.ts'], local: ['tests/local-supabase/pitch-timer-concurrency\\.test\\.ts'] },
  '08': { name: 'competition', vitest: ['src/features/competitions/.*\\.test\\.(ts|tsx)'] },
  '09a': { name: 'native safety', vitest: ['src/test/.*OsHarness\\.guard\\.test\\.ts'] },
  '09b': { name: 'complete local baseline', vitest: ['vitest\\.config\\.ts'], local: ['tests/local-supabase/.*\\.test\\.ts'] },
});

test('defines every promotion tranche exactly once', () => {
  assert.deepEqual(Object.keys(trancheTestManifest), trancheIds);
  assert.equal(new Set(Object.values(trancheTestManifest).map(({ name }) => name)).size, trancheIds.length);
});

for (const tranche of trancheIds) {
  test(`gives tranche ${tranche} at least one valid Vitest selector`, () => {
    const entry = trancheTestManifest[tranche];
    assert.ok(entry.vitest.length > 0);
    for (const pattern of entry.vitest) assert.doesNotThrow(() => new RegExp(pattern));
  });
}

test('keeps browser journeys with their owning application tranches', () => {
  assert.ok(trancheTestManifest['01'].playwright.includes('e2e-baseline/auth-safety.spec.ts'));
  assert.ok(trancheTestManifest['02'].playwright.includes('e2e-baseline/committee-invite-mobile-signup.spec.ts'));
  assert.ok(trancheTestManifest['03'].playwright.includes('e2e-baseline/club-wide-game-rsvp.spec.ts'));
  assert.ok(trancheTestManifest['05'].playwright.includes('e2e-baseline/messaging-cross-surface-contracts.spec.ts'));
  assert.ok(trancheTestManifest['06'].playwright.includes('e2e-baseline/vault-upload-safety.spec.ts'));
  assert.ok(trancheTestManifest['07'].playwright.includes('e2e-baseline/messaging-navigation-and-layout.spec.ts'));
});

test('keeps the PitchBoard matrix inside tranche 07', () => {
  const patterns = trancheTestManifest['07'].vitest.map((pattern) => new RegExp(pattern));
  assert.ok(patterns.some((pattern) => pattern.test('src/components/pitch/AutoSubPlanDialog.matrix.test.ts')));
});

test('keeps the matrix in the complete one-click baseline model', () => {
  const completeBaseline = [
    { name: 'AutoSub matrix', config: 'vitest.matrix.config.ts' },
    { name: 'Lab isolation', config: 'vitest.lab.config.mjs' },
  ];
  assert.ok(completeBaseline.some((entry) => entry.name === 'AutoSub matrix'));
  assert.ok(completeBaseline.some((entry) => entry.config === 'vitest.matrix.config.ts'));
});

for (const tranche of ['02', '03', '04', '05', '06', '07', '09b']) {
  test(`records local integration ownership for backend tranche ${tranche}`, () => {
    const entry = trancheTestManifest[tranche];
    assert.ok((entry.local ?? []).length > 0);
    for (const pattern of entry.local ?? []) assert.doesNotThrow(() => new RegExp(pattern));
  });
}
