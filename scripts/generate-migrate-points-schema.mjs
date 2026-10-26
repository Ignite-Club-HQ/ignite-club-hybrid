// Generate from the committed compiler-produced DID plus the actual private
// snapshot declaration. No canister build, deployment or hand-written wire types.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(root + 'backend/club_points_domain/src/main.mo', 'utf8');
const match = source.match(/type PointsSnapshot = \{([^}]+)\}/);
if (!match) throw Error('Points snapshot declaration missing');
const fields = match[1].split(';').map(x => x.trim()).filter(Boolean).map(x => {
  const f = x.match(/^(\w+)\s*:\s*\[Types\.(\w+)\]$/);
  if (!f) throw Error('Points snapshot declaration changed; review generator');
  return `${f[1]}: vec ${f[2]};`;
});
const did = readFileSync(root + 'backend/club_points_domain/club_points_domain.did', 'utf8');
const end = did.lastIndexOf('service :');
if (end < 0) throw Error('Compiled points contract missing');
const output = did.slice(0, end) + `type PointsSnapshot = record { ${fields.join(' ')} };\nservice : { zz_migrate_schema: (PointsSnapshot) -> () query; }\n`;
const path = root + 'scripts/migrate-schemas/club_points_domain.snapshot.did';
writeFileSync(path, output);
const temp = '/tmp/migrate-points-bindings'; mkdirSync(temp, { recursive: true });
const r = spawnSync(root + 'frontend/node_modules/.bin/icp-bindgen', ['--force', '--did-file', path, '--out-dir', temp], { stdio: 'inherit' });
if (r.status !== 0) throw Error('Points schema generation failed');
writeFileSync(path + '.js', readFileSync(temp + '/declarations/club_points_domain.snapshot.did.js', 'utf8').replace(/^import \{ IDL \}.*\n/m, ''));