import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GROUP_BUILD_SERVICES = Object.freeze([
  'club_domain', 'events_domain', 'messaging_domain', 'vault_domain',
  'competition_domain', 'club_points_domain', 'mini_league_domain',
  'media_metadata', 'insights_domain', 'notification_queue',
  'pii_access_control', 'timer_jobs', 'media_blob_store',
]);

/** CLI 1.7.0 saves final recipe output under extensionless canister names.
 * Use these artifacts, not intermediate Mops/Cargo output or a cache glob. */
export function stageGroupWasm(projectRoot, destination) {
  const artifacts = GROUP_BUILD_SERVICES.map(name => {
    const source = join(projectRoot, '.icp', 'cache', 'artifacts', name);
    const bytes = readFileSync(source);
    const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const wasm = bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    if (!gzip && !wasm) throw new Error(`Invalid or empty build artifact for ${name}`);
    return { name, source, bytes, extension: gzip ? '.wasm.gz' : '.wasm' };
  });
  // Validate the complete inventory before publishing any installation input.
  mkdirSync(destination, { recursive: true });
  for (const artifact of artifacts) {
    writeFileSync(join(destination, artifact.name + artifact.extension), artifact.bytes);
    console.log(`${artifact.name} <- ${artifact.source}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [projectRoot, destination] = process.argv.slice(2);
  if (!projectRoot || !destination) throw new Error('Usage: stage-group-wasm <ICP project root> <destination>');
  stageGroupWasm(projectRoot, destination);
}