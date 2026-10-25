import test from 'node:test';
import assert from 'node:assert/strict';
import { publishVerifiedFiles, requirePublicationReadback } from './all-group-publication.mjs';
const release='a'.repeat(40),commit='b'.repeat(40),tree='c'.repeat(40),branch='refs/heads/main';
const files=[{path:'frontend/src/live/generated/routingGates.ts',content:'verified'}];
function fixture(){let head=release;const calls=[];const api=(path,method='GET',body)=>{calls.push({path,method,body});if(path==='git/ref/heads/main')return{object:{sha:head}};if(path===`git/commits/${release}`)return{tree:{sha:'d'.repeat(40)}};if(path==='git/trees')return{sha:tree};if(path==='git/commits')return{sha:commit};if(path===`git/commits/${commit}`)return{tree:{sha:tree},parents:[{sha:release}]};if(path==='git/refs/heads/main'){assert.equal(body.force,false);head=body.sha;return{};}if(path.startsWith('contents/'))return{encoding:'base64',content:Buffer.from('verified').toString('base64')};throw Error(path);};return{api,calls,setHead:v=>{head=v;}};}
test('publication objects precede branch writes; exact acknowledgement is required to advance',()=>{
  const f=fixture(),journal={complete:true,snapshotVerified:true};const options={branch,release,journal,files};
  journal.publication=publishVerifiedFiles(f.api,options);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
  publishVerifiedFiles(f.api,options);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);requirePublicationReadback(f.api,branch,journal.publication);
});
test('lost branch response can settle exact commit without a second update',()=>{
  const f=fixture(),journal={complete:true,snapshotVerified:true};const options={branch,release,journal,files};journal.publication=publishVerifiedFiles(f.api,options);f.setHead(commit);publishVerifiedFiles(f.api,options);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
});
test('advanced branch is never overwritten or rebased',()=>{
  const f=fixture();f.setHead('e'.repeat(40));assert.throws(()=>publishVerifiedFiles(f.api,{branch,release,journal:{complete:true,snapshotVerified:true},files}));assert.equal(f.calls.some(c=>c.method==='PATCH'),false);
});
test('unverified release and unrelated file paths cannot publish',()=>{
  const f=fixture();assert.throws(()=>publishVerifiedFiles(f.api,{branch,release,journal:{complete:false},files}));assert.throws(()=>publishVerifiedFiles(f.api,{branch,release,journal:{complete:true,snapshotVerified:true},files:[{path:'.github/workflows/evil.yml',content:''}]}));
});
test('publication content and exact commit readback must agree',()=>{
  const f=fixture(),journal={complete:true,snapshotVerified:true};journal.publication=publishVerifiedFiles(f.api,{branch,release,journal,files});assert.throws(()=>publishVerifiedFiles(f.api,{branch,release,journal,files:[{...files[0],content:'changed'}]}));assert.throws(()=>requirePublicationReadback(f.api,branch,journal.publication));
});