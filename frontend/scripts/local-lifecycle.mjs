import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { filesDigest, verifyBackup } from './snapshot-files.mjs';

const json = file => JSON.parse(fs.readFileSync(file,'utf8'));
function atomic(file, value) { const temp=`${file}.${randomUUID()}.tmp`; fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n'); fs.renameSync(temp,file); }
function processInfo(pid) {
  try {
    const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
    const parts=stat.slice(stat.lastIndexOf(')')+2).split(' ');
    return {pid:Number(pid),ppid:Number(parts[1]),start:parts[19],exe:fs.readlinkSync(`/proc/${pid}/exe`)};
  } catch { return null; }
}
function ownedChild(root, descriptor) {
  if (descriptor['project-dir']!==root || descriptor.network!=='local') throw new Error('Network belongs to another project');
  const boot=Number(fs.readFileSync('/proc/stat','utf8').match(/^btime (\d+)$/m)?.[1]);
  const ticks=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim());
  const candidates=fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p)).map(processInfo).filter(Boolean).filter(p=>{
    if (path.basename(p.exe)!=='pocket-ic') return false;
    if (Math.abs(boot+Number(p.start)/ticks-descriptor['child-locator']['start-time'])>=3) return false;
    try {
      const args=fs.readFileSync(`/proc/${p.pid}/cmdline`,'utf8').split('\0');
      const index=args.indexOf('--port-file');
      if (index<0 || !args[index+1]?.startsWith('/tmp/')) return false;
      // The launcher may delete its temporary port file while PocketIC survives.
      // Match the descriptor's listening socket to this exact process instead.
      const sockets=new Set(fs.readdirSync(`/proc/${p.pid}/fd`).flatMap(fd=>{
        try { const match=fs.readlinkSync(`/proc/${p.pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/); return match ? [match[1]] : []; } catch { return []; }
      }));
      return ['tcp','tcp6'].some(protocol=>fs.readFileSync(`/proc/${p.pid}/net/${protocol}`,'utf8').trim().split('\n').slice(1).some(line=>{
        const fields=line.trim().split(/\s+/);
        return fields[3]==='0A' && parseInt(fields[1].split(':')[1],16)===descriptor['pocketic-config-port'] && sockets.has(fields[9]);
      }));
    } catch { return false; }
  });
  if (candidates.length!==1) throw new Error('Cannot establish unique ownership of local PocketIC process');
  return candidates[0];
}
export function requireOwnedNetwork(root) {
  return ownedChild(root,json(path.join(root,'.icp/cache/networks/local/descriptor.json')));
}
async function released() {
  for (let n=0;n<100;n++) {
    const open=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:4943});s.setTimeout(200);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(true);});});
    if (!open) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Local listener did not release port 4943; no unrelated process was signalled');
}
export function lifecycle({root,local,icp,publicConfig}) {
  const auth=['-n','local','--identity','ignite-lab-governor'];
  const descriptorFile=path.join(root,'.icp/cache/networks/local/descriptor.json');
  const latestFile=path.join(local,'latest-backup.json'), resumeFile=path.join(local,'resume-network.json');
  function latest() {
    const pointer=json(latestFile); const dir=path.resolve(local,'backups',pointer.directory);
    if (path.dirname(dir)!==path.join(local,'backups')) throw new Error('Invalid backup location');
    verifyBackup(dir); return dir;
  }
  function backup(leaveStopped=false) {
    const binding=publicConfig(), network=json(descriptorFile).id;
    const mappingPath=path.join(root,'.icp/cache/mappings/local.ids.json');
    const mapping=json(mappingPath);
    const canisters=Object.entries(mapping).filter(([, id]) => /^[a-z0-9-]+$/.test(id));
    if (!canisters.length) throw new Error('No deployed canisters to back up');
    const dir=path.join(local,'backups',`${Date.now()}-${randomUUID()}`);
    fs.mkdirSync(dir,{recursive:true});
    for (const [, id] of canisters) icp(['canister','stop',id,...auth]);
    let success=false;
    try {
      const backupCanisters={};
      for (const [name, id] of canisters) {
        const snapshotId=icp(['canister','snapshot','create',id,...auth,'--quiet'],true).trim();
        if (!/^[0-9a-f]+$/i.test(snapshotId)) throw new Error(`Invalid snapshot ID for ${name}`);
        const snapshot=path.join(dir,name);
        icp(['canister','snapshot','download',id,snapshotId,...auth,'--output',snapshot]);
        backupCanisters[name]={ canisterId:id, snapshotId, files:filesDigest(snapshot) };
      }
      atomic(path.join(dir,'manifest.json'),{format:2,network:'local',networkId:network,canisters:backupCanisters,files:{format:'multi-canister'}});
      verifyBackup(dir);
      atomic(latestFile,{directory:path.basename(dir)});
      success=true; console.log(`Verified full backup: ${path.relative(root,dir)}`); return dir;
    } finally { if (!leaveStopped || !success) for (const [, id] of canisters) icp(['canister','start',id,...auth]); }
  }
  function restore(dir, probe=false, replaceExisting=false) {
    const manifest=verifyBackup(dir); // Validate every byte before creating anything.
    const mapping=path.join(root,'.icp/cache/mappings/local.ids.json');
    if (!probe && !replaceExisting && fs.existsSync(mapping) && json(mapping).club_links) throw new Error('Refusing to overwrite an existing local canister mapping');
    if (manifest.format === 1) {
      const id=icp(['canister','create','--detached',...auth,'--quiet'],true).trim();
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid restore destination');
      icp(['canister','stop',id,...auth]);
      const snapshotId=icp(['canister','snapshot','upload',id,...auth,'--input',path.join(dir,'snapshot'),'--quiet'],true).trim();
      if (!/^[0-9a-f]+$/i.test(snapshotId)) throw new Error('Invalid uploaded snapshot ID');
      icp(['canister','snapshot','restore',id,snapshotId,...auth]);
      icp(['canister','start',id,...auth]);
      if (probe) atomic(path.join(local,'full-restore-probe.json'),{canisterId:id});
      else { icp(['canister','link','club_links',id,'-e','local']); publicConfig(); }
      console.log(`Legacy full snapshot restored to new local canister ${id}`); return id;
    }
    const restored={};
    for (const [name, item] of Object.entries(manifest.canisters)) {
      const id=icp(['canister','create','--detached',...auth,'--quiet'],true).trim();
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid restore destination for ${name}`);
      icp(['canister','stop',id,...auth]);
      const snapshotId=icp(['canister','snapshot','upload',id,...auth,'--input',path.join(dir,name),'--quiet'],true).trim();
      if (!/^[0-9a-f]+$/i.test(snapshotId)) throw new Error(`Invalid uploaded snapshot ID for ${name}`);
      icp(['canister','snapshot','restore',id,snapshotId,...auth]);
      icp(['canister','start',id,...auth]);
      restored[name]=id;
    }
    if (probe) atomic(path.join(local,'full-restore-probe.json'),{canisters:restored});
    else {
      atomic(path.join(root,'.icp/cache/mappings/local.ids.json'),restored);
      icp(['canister','link','club_links',restored.club_links,'-e','local']);
      publicConfig();
    }
    console.log(`Full multi-canister snapshot restored: ${Object.keys(restored).length} canisters`); return restored;
  }
  async function stop() {
    publicConfig();
    const d=json(descriptorFile), child=ownedChild(root,d);
    const dir=backup(true); // Freezes writes through network shutdown; no checkpoint race.
    const manifest=json(path.join(dir,'manifest.json'));
    atomic(resumeFile,{directory:path.basename(dir),networkId:d.id,canisterId:manifest.canisterId,canisters:manifest.canisters});
    try { icp(['network','stop','local']); } catch (error) { console.warn('CLI stop failed; stopping only the verified PocketIC process:',error.message); }
    const still=processInfo(child.pid);
    if (still && still.start===child.start && still.exe===child.exe) process.kill(child.pid,'SIGTERM');
    await released();
    console.log('Local network stopped with a verified full recovery snapshot.');
  }
  function start() {
    let running=null;
    try { running=JSON.parse(icp(['network','status','local','--json'],true)); } catch { /* expected for stopped network */ }
    let owned=false;
    try { requireOwnedNetwork(root); owned=true; } catch { /* stale descriptor */ }
    if (running?.managed && owned) {
      if (fs.existsSync(resumeFile)) {
        const plan=json(resumeFile);
        if (plan.networkId===json(descriptorFile).id && plan.canisters) {
          for (const id of Object.values(plan.canisters).map(item => item.canisterId ?? item)) icp(['canister','start',id,...auth]);
        } else if (plan.networkId===json(descriptorFile).id && plan.canisterId) {
          icp(['canister','start',plan.canisterId,...auth]);
        } else {
          const dir=path.resolve(local,'backups',plan.directory);
          if (path.dirname(dir)!==path.join(local,'backups')) throw new Error('Invalid recovery plan');
          if (fs.existsSync(path.join(root,'.icp/cache/mappings/local.ids.json'))) fs.rmSync(path.join(root,'.icp/cache/mappings/local.ids.json'),{force:true});
          restore(dir,false,true);
        }
        fs.unlinkSync(resumeFile);
      }
      console.log('Local network already running.'); return;
    }
    let dir=null;
    if (fs.existsSync(resumeFile)) {
      const plan=json(resumeFile); dir=path.resolve(local,'backups',plan.directory);
      if (path.dirname(dir)!==path.join(local,'backups')) throw new Error('Invalid recovery plan');
      verifyBackup(dir);
    } else if (fs.existsSync(path.join(local,'public.json'))) throw new Error('No current full shutdown snapshot. Refusing a potentially destructive fresh-network start.');
    icp(['network','start','local','-d']);
    if (dir) {
      if (fs.existsSync(path.join(root,'.icp/cache/mappings/local.ids.json'))) fs.rmSync(path.join(root,'.icp/cache/mappings/local.ids.json'),{force:true});
      restore(dir,false,true); fs.unlinkSync(resumeFile);
    }
  }
  return {backup,stop,start,probe:()=>restore(latest(),true),verify:()=>verifyBackup(latest())};
}
