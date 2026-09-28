import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function filesDigest(root) {
  if (!fs.lstatSync(root).isDirectory()) throw new Error('Snapshot root must be a real directory');
  const files = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const full = path.join(dir,entry.name);
      if (entry.isSymbolicLink()) throw new Error('Snapshot symlinks are forbidden');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const bytes=fs.readFileSync(full);
        files[path.relative(root,full)]={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
      } else throw new Error('Invalid snapshot file');
    }
  }
  walk(root); return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export function verifyBackup(dir) {
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  if (![1, 2].includes(manifest.format) || manifest.network!=='local' || !Object.keys(manifest.files??{}).length) throw new Error('Invalid full-backup manifest');
  if (manifest.format === 1 && !manifest.canisterId) throw new Error('Invalid legacy backup canister');
  if (manifest.format === 2 && (!manifest.canisters || !Object.keys(manifest.canisters).length)) throw new Error('Invalid multi-canister backup');
  if (manifest.format === 2) {
    for (const [name, item] of Object.entries(manifest.canisters)) {
      if (!item.canisterId || !item.snapshotId || !item.files || JSON.stringify(filesDigest(path.join(dir, name))) !== JSON.stringify(item.files)) throw new Error(`Snapshot checksum mismatch for ${name}; refusing restore`);
    }
    return manifest;
  }
  const current=filesDigest(path.join(dir,'snapshot'));
  if (JSON.stringify(current)!==JSON.stringify(manifest.files)) throw new Error('Snapshot checksum mismatch; refusing restore');
  return manifest;
}
