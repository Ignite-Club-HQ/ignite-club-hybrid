// Isolated local allocator fixture: never deploys or activates real stores.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cwd = join(root, 'backend/media_blob_store');
const staging = mkdtempSync(join(tmpdir(), 'ignite-club-space-'));
const compiler = join(process.env.HOME || '/root', '.cache/mops/moc/1.16.1/moc');
const sources = execFileSync('mops', ['sources'], { cwd, encoding: 'utf8' }).trim().split(/\s+/);
const idlFactory = () => IDL.Service({
  runTests: IDL.Func([], [], []), prepareUpgrade: IDL.Func([], [], []), verifyUpgrade: IDL.Func([], [], []),
});
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
let server;
let pic;
try {
  server = await PocketIcServer.start({ binPath: '/tmp/pocket-ic' });
  pic = await PocketIc.create(server.getUrl());
  for (const fixture of ['clubPhysicalSpace', 'packedClubBytes', 'segmentedClubBytes']) {
    const wasm = join(staging, `${fixture}.wasm`);
    execFileSync(compiler, [...sources, '-o', wasm, `test/${fixture}.test.mo`], { cwd, stdio: 'inherit' });
    const test = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor] });
    await test.actor.runTests();
    const persistent = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor] });
    await persistent.actor.prepareUpgrade();
    await pic.upgradeCanister({ canisterId: persistent.canisterId, wasm, sender: governor,
      upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    await persistent.actor.verifyUpgrade();
    console.log(`PASS: ${fixture} actual upgrade and stale-request recovery.`);
  }
  console.log('PASS: owned roots, no shared-tail borrowing, stale-generation refusal and actual upgrade persistence.');
  console.log('PASS: tiny-file/fragmented-root counterexample retained; payload-byte lifetime guarantee is NOT certified.');
  console.log('PASS: 1,024 one-byte ciphertext objects share one 64 KiB page; customer actual-byte allowance unchanged.');
} finally {
  if (pic) await pic.tearDown();
  if (server) await server.stop();
  rmSync(staging, { recursive: true, force: true });
}