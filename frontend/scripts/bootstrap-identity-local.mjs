import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { IDL } from '@icp-sdk/core/candid';
import { createPrivateKey } from 'node:crypto';
import { syntheticIdentity, syntheticAcl } from '../src/lab/syntheticIdentities.mjs';
import { init as clubInit } from '../src/lab/bindings/declarations/club_links.did.js';

const root = path.resolve(import.meta.dirname, '../..');
const local = path.join(root, '.local-icp', 'identity-bootstrap');
fs.mkdirSync(local, { recursive: true });
const env = { ...process.env, XDG_CONFIG_HOME: path.join(local, 'config'), XDG_CACHE_HOME: path.join(local, 'cache'), XDG_DATA_HOME: path.join(local, 'share'), DO_NOT_TRACK: '1', ICP_PROJECT_ROOT: root };
const icp = (args, capture = false) => execFileSync('icp', ['--project-root-override', root, ...args], { cwd: root, env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
const network = 'identity-bootstrap';
const port = 5021;
const pem = path.join(local, 'governor.pem');
if (!fs.existsSync(pem)) {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'), Buffer.alloc(32,1)]), format: 'der', type: 'pkcs8' });
  fs.writeFileSync(pem, key.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
}
const names = icp(['identity', 'list'], true);
if (!names.includes('ignite-lab-governor')) icp(['identity', 'import', 'ignite-lab-governor', '--from-pem', pem, '--storage', 'plaintext']);
const status = () => JSON.parse(icp(['network', 'status', network, '--json'], true));
try { status(); } catch { icp(['network', 'start', network, '-d']); }
const clubArgs = path.join(local, 'club-init.bin');
const identityArgs = path.join(local, 'identity-init.bin');
fs.writeFileSync(clubArgs, new Uint8Array(IDL.encode(clubInit({ IDL }), [syntheticIdentity('governor').getPrincipal(), syntheticAcl()])));
const identityInit = IDL.Record({ governor: IDL.Principal });
fs.writeFileSync(identityArgs, new Uint8Array(IDL.encode([identityInit], [{ governor: syntheticIdentity('governor').getPrincipal() }])));
const club = icp(['canister', 'create', '--detached', '-n', network, '--identity', 'ignite-lab-governor', '--quiet'], true).trim();
const identity = icp(['canister', 'create', '--detached', '-n', network, '--identity', 'ignite-lab-governor', '--quiet'], true).trim();
icp(['canister', 'install', club, '-n', network, '--identity', 'ignite-lab-governor', '--mode', 'install', '--wasm', 'target/wasm32-unknown-unknown/release/club_links.wasm', '--args-file', clubArgs, '--args-format', 'bin']);
icp(['canister', 'install', identity, '-n', network, '--identity', 'ignite-lab-governor', '--mode', 'install', '--wasm', 'target/wasm32-unknown-unknown/release/identity_access.wasm', '--args-file', identityArgs, '--args-format', 'bin']);
const networkStatus = status();
fs.writeFileSync(path.join(local, 'config.json'), JSON.stringify({ network, port, club, identity, rootKey: networkStatus.root_key, apiUrl: networkStatus.api_url }, null, 2) + '\n');
console.log(JSON.stringify({ network, port, club, identity, apiUrl: networkStatus.api_url }, null, 2));
