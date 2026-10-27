import test from 'node:test';
import assert from 'node:assert/strict';
import { publishVerifiedFiles, requirePublicationReadback, settlePublishedEvidence, EVIDENCE_BRANCH } from './all-group-publication.mjs';
import { digest } from './all-group-upgrade-policy.mjs';
const release='a'.repeat(40),commit='b'.repeat(40),tree='c'.repeat(40),branch='refs/heads/main';
const files=[{path:'frontend/src/live/generated/routingGates.ts',content:'verified'}];
const verified=()=>({complete:true,snapshotVerified:true,snapshotFiles:files,snapshotFilesHash:digest(files)});
function fixture(){let head=release,exists=true,created=null;const calls=[];const api=(path,method='GET',body)=>{calls.push({path,method,body});if(path==='git/matching-refs/heads/all-group-upgrade-evidence')return exists?[{ref:EVIDENCE_BRANCH}]:[];if(path==='git/refs'&&method==='POST'){assert.equal(body.ref,EVIDENCE_BRANCH);assert.equal(body.sha,release);exists=true;head=body.sha;return{};}if(path==='git/ref/heads/all-group-upgrade-evidence')return{object:{sha:head}};if(path==='git/trees')return{sha:tree};if(path==='git/commits'&&method==='POST'){created={parents:body.parents,tree:body.tree};return{sha:commit};}if(path===`git/commits/${commit}`)return{tree:{sha:created.tree},parents:created.parents.map(sha=>({sha}))};if(path===`git/commits/${head}`)return{tree:{sha:'d'.repeat(40)}};if(path==='git/refs/heads/all-group-upgrade-evidence'){assert.equal(body.force,false);head=body.sha;return{};}if(path.startsWith('contents/'))return{encoding:'base64',content:Buffer.from('verified').toString('base64')};throw Error(path);};return{api,calls,setHead:v=>{head=v;},setExists:v=>{exists=v;}};}
test('publication objects precede branch writes; exact acknowledgement is required to advance',()=>{
  const f=fixture(),journal=verified();const options={branch,release,journal,files};
  journal.publication=publishVerifiedFiles(f.api,options);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
  publishVerifiedFiles(f.api,options);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);requirePublicationReadback(f.api,branch,journal.publication);
});
test('lost branch response can settle exact commit without a second update',()=>{
  const f=fixture(),journal=verified();const options={branch,release,journal,files};journal.publication=publishVerifiedFiles(f.api,options);f.setHead(commit);publishVerifiedFiles(f.api,options);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
});
test('advanced evidence branch is never overwritten or rebased',()=>{
  const f=fixture(),journal=verified();const options={branch,release,journal,files};journal.publication=publishVerifiedFiles(f.api,options);f.setHead('e'.repeat(40));assert.throws(()=>publishVerifiedFiles(f.api,options),/Evidence branch advanced/);assert.equal(f.calls.some(c=>c.method==='PATCH'),false);
});
test('unverified release and unrelated file paths cannot publish',()=>{
  const f=fixture();assert.throws(()=>publishVerifiedFiles(f.api,{branch,release,journal:{complete:false},files}));assert.throws(()=>publishVerifiedFiles(f.api,{branch,release,journal:{complete:true,snapshotVerified:true},files:[{path:'.github/workflows/evil.yml',content:''}]}));
});
test('publication content and exact commit readback must agree',()=>{
  const f=fixture(),journal=verified();journal.publication=publishVerifiedFiles(f.api,{branch,release,journal,files});assert.throws(()=>publishVerifiedFiles(f.api,{branch,release,journal,files:[{...files[0],content:'changed'}]}));assert.throws(()=>requirePublicationReadback(f.api,branch,journal.publication));
});
test('complete backend manifest is the only additional allowed publication path',()=>{
  const f=fixture(),manifest=[{path:'deploy/mainnet/backend-release.json',content:'verified'}];
  const journal={complete:true,snapshotVerified:true,snapshotFiles:manifest,snapshotFilesHash:digest(manifest)};
  assert.ok(publishVerifiedFiles(f.api,{branch,release,journal,files:manifest}));
  const other=[{path:'deploy/mainnet/other.json',content:'verified'}];
  assert.throws(()=>publishVerifiedFiles(f.api,{branch,release,journal:{...journal,snapshotFiles:other,snapshotFilesHash:digest(other)},files:other}),/allowlisted/);
});
test('recovery publishes against pinned repair source without rewriting original release binding',()=>{
  const f=fixture(),journal=verified();journal.binding={release:'f'.repeat(40)};
  journal.recovery={source:release,branch,planHash:digest(journal.binding)};
  const before=JSON.stringify(journal.binding),options={branch,release,journal,files};
  journal.publication=publishVerifiedFiles(f.api,options);publishVerifiedFiles(f.api,options);
  assert.equal(JSON.stringify(journal.binding),before);
  assert.equal(f.calls.find(c=>c.path==='git/commits'&&c.method==='POST').body.parents[0],release);
  assert.throws(()=>publishVerifiedFiles(f.api,{...options,release:'e'.repeat(40)}),/recovery binding/);
});
test('evidence branch is created at the release source when missing; main is never written',()=>{
  const f=fixture();f.setExists(false);const journal=verified();const options={branch,release,journal,files};
  journal.publication=publishVerifiedFiles(f.api,options);publishVerifiedFiles(f.api,options);
  assert.equal(f.calls.find(c=>c.path==='git/refs'&&c.method==='POST').body.sha,release);
  assert.equal(f.calls.some(c=>c.method!=='GET'&&String(c.path).includes('heads/main')&&!String(c.path).includes('contents/')),false);
});
test('publication records the evidence parent for exact acknowledgement',()=>{
  const f=fixture(),journal=verified();
  const publication=publishVerifiedFiles(f.api,{branch,release,journal,files});
  assert.equal(publication.parent,release);
});
test('settle requires a complete unpublished release with retained evidence',()=>{
  const f=fixture();
  assert.throws(()=>settlePublishedEvidence(f.api,branch,verified()),/Complete unpublished/);
  assert.throws(()=>settlePublishedEvidence(f.api,branch,{...verified(),published:true,publication:{commit,tree}}),/Complete unpublished/);
  assert.throws(()=>settlePublishedEvidence(f.api,'main',{...verified(),publication:{commit,tree}}),/Source branch/);
});
test('settle passes only when the exact snapshot files reached the source branch',()=>{
  const f=fixture(),journal={...verified(),publication:{commit,tree}};
  settlePublishedEvidence(f.api,branch,journal);
  assert.ok(f.calls.some(c=>c.path==='contents/frontend/src/live/generated/routingGates.ts?ref=heads/main'));
  const differing=()=>{throw Error('missing');};
  assert.throws(()=>settlePublishedEvidence(differing,branch,journal),/missing/);
  const changed=(path)=>path.startsWith('contents/')?{encoding:'base64',content:Buffer.from('changed').toString('base64')}:(()=>{throw Error(path);})();
  assert.throws(()=>settlePublishedEvidence(changed,branch,journal),/not yet on heads\/main/);
});
