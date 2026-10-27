// Isolated acceptance only: no deployment, production credentials or ICP CLI.
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAME_TEST_CANISTERS = ['club_domain', 'messaging_domain', 'competition_domain', 'mini_league_domain', 'pii_access_control', 'media_blob_store'];
export function privateNameTestEnvironment(parent, publicKey, signerPath) {
  if (!/^[a-f0-9]{64}$/.test(publicKey) || !signerPath) throw Error('Disposable signer required');
  // Pass only tooling/environment settings, not inherited production secrets.
  const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'TMPDIR', 'CARGO_HOME', 'RUSTUP_HOME', 'LANG', 'CI', 'NODE_OPTIONS', 'NIX_LD', 'NIX_LD_LIBRARY_PATH'].filter(key => parent[key]).map(key => [key, parent[key]]));
  return { ...env, IGNITE_PRIVATE_PROFILE_READS_REHEARSAL: '1', IGNITE_PRIVATE_NAME_APPROVER_PUBLIC_KEY: publicKey, PRIVATE_NAME_FIXTURE_SIGNER: signerPath, IGNITE_NAME_EDIT_REPLICA: '1' };
}

export function runPrivateNameAcceptance({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), reportPath = process.env.NAME_TEST_REPORT_PATH, run = spawnSync } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ignite-name-acceptance-'));
  const signer = join(directory, 'fixture-signer.pem');
  const keys = generateKeyPairSync('ed25519');
  writeFileSync(signer, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const env = privateNameTestEnvironment(process.env, publicKey, signer);
  const report = { kind: 'private-name-isolated-acceptance-v1', productionChanged: false, deploymentAuthorized: false, conversionAuthorized: false, passed: false, steps: [] };
  const command = (label, executable, args, cwd = root, capture = false) => {
    console.log(`\n${label}`);
    const result = run(executable, args, { cwd, env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) { report.steps.push({ label, passed: false }); throw Error(`${label} failed; no production action performed`); }
    if (!capture) report.steps.push({ label, passed: true });
    return result.stdout ?? '';
  };
  try {
    // Use the installed package's pinned PocketIC download, never a live host.
    command('Install pinned disposable PocketIC', process.execPath, ['node_modules/@dfinity/pic/postinstall.mjs'], join(root, 'frontend'));
    env.POCKET_IC_BIN = join(root, 'frontend/node_modules/@dfinity/pic/pocket-ic');
    command('Restore pinned Motoko compiler', 'mops', ['toolchain', 'use', 'moc', '1.16.1']);
    const moc = join(homedir(), '.cache/mops/moc/1.16.1/moc');
    for (const domain of NAME_TEST_CANISTERS) {
      const cwd = join(root, 'backend', domain);
      command(`Install ${domain} compiler libraries`, 'mops', ['install'], cwd);
      const sources = command(`Resolve ${domain} libraries`, 'mops', ['sources'], cwd, true).trim().split(/\s+/).filter(Boolean);
      const output = domain === 'media_blob_store' ? 'main.wasm' : `.mops/.build/${domain}.wasm`;
      mkdirSync(join(cwd, '.mops/.build'), { recursive: true });
      command(`Compile disposable ${domain}`, moc, [...sources, '--default-persistent-actors', '--enhanced-migration', 'src/backend/migrations', ...(domain === 'media_blob_store' ? ['--max-stable-pages', '3932160'] : []), '-o', output, 'src/main.mo'], cwd);
    }
    command('Compile disposable identity and registries', 'cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'identity_access', '-p', 'shard_router', '-p', 'placement_registry']);
    delete env.IGNITE_PRIVATE_PROFILE_READS_REHEARSAL;
    env.IGNITE_PRIVATE_NAME_CLEANUP_RELEASE='1';
    command('Compile cleanup-only identity with private reads/conversion disabled', 'cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--target-dir','target/private-name-cleanup', '-p', 'identity_access']);
    delete env.IGNITE_PRIVATE_NAME_CLEANUP_RELEASE;
    env.IGNITE_PRIVATE_PROFILE_READS_REHEARSAL='1';
    command('Verify exact identity cleanup routing', 'cargo', ['test', '--locked', '-p', 'identity_access', 'private_name_cleanup']);
    const scripts = ['convert-private-names', 'private-name-canister-adapters', 'private-name-club-inventory', 'private-name-plan-artifact', 'private-name-prepared-execution', 'private-name-execution-journal', 'private-name-saved-approval', 'private-name-approval-delivery', 'private-name-verified-preparation', 'private-name-replica-lifecycle', 'private-name-lifecycle-adapter', 'private-name-github-protection'];
    command('Check essential conversion and approval rules', process.execPath, ['--test', ...scripts.map(name => `scripts/${name}.test.mjs`)]);
    const frontend = join(root, 'frontend');
    command('Verify real locked conversion and interrupted recovery', process.execPath, ['scripts/test-private-name-coordinator-replica.mjs'], frontend);
    command('Verify real name-copy update and deletion recovery', process.execPath, ['scripts/test-private-name-lifecycle-replica.mjs'], frontend);
    command('Compile held-edit drain fixture', moc, ['--package', 'core', join(root, 'backend/club_domain/.mops/core@2.6.1/src'), '--default-persistent-actors', '-o', '/tmp/private-name-preparation-fixture.wasm', 'backend/shared/test/privateNamePreparationFixture.mo']);
    command('Verify in-progress edits remain locked', process.execPath, ['scripts/test-private-name-preparation-drain-replica.mjs'], frontend);
    command('Verify encrypted chat and event name displays', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.legacy.config.mjs', 'src/live/privateNameEdit.replica.test.tsx', 'src/live/identityProfile.privateNames.test.ts', 'src/live/privateProfileNames.test.ts', 'src/live/chatRelationshipProfiles.test.ts', 'src/hooks/usePrivateChatProfiles.test.tsx', 'src/features/events/rsvpDisplayProfiles.test.ts', 'src/live/scheduleMembers.test.ts'], frontend);
    delete env.IGNITE_PRIVATE_PROFILE_READS_REHEARSAL;
    delete env.IGNITE_PRIVATE_NAME_APPROVER_PUBLIC_KEY;
    command('Compile production-only identity without private-name rehearsals', 'cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'identity_access']);
    env.IGNITE_CLUB_DISPLAY_REPLICA='1';
    command('Verify production-only secure saves and exact-club display', process.execPath, ['node_modules/vitest/vitest.mjs','run','--config','vitest.legacy.config.mjs','src/live/privateClubNameDisplays.replica.test.tsx'],frontend);
    delete env.IGNITE_CLUB_DISPLAY_REPLICA;
    command('Verify unchanged ICP production boundaries', process.execPath, ['frontend/scripts/check-icp-guards.mjs']);
    report.passed = true;
    return report;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runPrivateNameAcceptance(); console.log('PASS: isolated name acceptance only; live conversion remains separately blocked.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}