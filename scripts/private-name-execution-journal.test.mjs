import {test,mock} from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,appendFileSync,statSync,symlinkSync,truncateSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePrivateNameArtifact} from './private-name-plan-artifact.mjs';
import {openPreparedExecutionJournal,MAX_EXECUTION_JOURNAL_BYTES} from './private-name-execution-journal.mjs';

async function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'name-journal-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const artifact=await preparePrivateNameArtifact({identityId:'identity',operator:'owner',deploymentHash:'a'.repeat(64),inventoryHash:'b'.repeat(64),historyRevision:'7',sinks:[{id:'pii',publicKey:[1]}],rows:[{accountId:'a1',subject:'person1',sink:'pii',name:'Private Name',clubs:['club1']}]},{encryptName:async()=>[2],encryptClubName:async()=>[3]});
  const path=join(directory,'journal'),lock={held:true};
  const entry={planHash:artifact.hash,sink:'pii',subject:'person1',club:null,hash:createHash('sha256').update(Uint8Array.from([2])).digest('hex'),ciphertext:[2],phase:'unknown'};
  const open=()=>openPreparedExecutionJournal(path,{artifact,expectedHash:artifact.hash,assertHeld:()=>lock.held});
  return {path,artifact,lock,entry,open};
}
test('exclusive private creation and reopen preserve ciphertext-only unknown intent',async t=>{
  const s=await fixture(t);let j=s.open();j.put('original:a1',s.entry);j.close();
  assert.equal(statSync(s.path).mode&0o777,0o600);assert.equal(readFileSync(s.path,'utf8').includes('Private Name'),false);
  j=s.open();assert.deepEqual(j.get('original:a1'),s.entry);assert.deepEqual(j.ids(),['original:a1']);j.close();
});
test('missing independent lock refuses file creation',async t=>{
  const s=await fixture(t);s.lock.held=false;assert.throws(s.open,/exclusive journal lock/);assert.throws(()=>statSync(s.path),/ENOENT/);
});
test('missing parent is not automatically created; provisioned nested directories support reopen',async t=>{
  const s=await fixture(t),parent=join(s.path+'.directory','nested'),path=join(parent,'receipts');
  const open=()=>openPreparedExecutionJournal(path,{artifact:s.artifact,expectedHash:s.artifact.hash,assertHeld:()=>true});
  assert.throws(open,/ENOENT/);assert.throws(()=>statSync(parent),/ENOENT/);
  mkdirSync(parent,{recursive:true,mode:0o700});let j=open();j.put('original:a1',s.entry);j.close();
  j=open();assert.deepEqual(j.get('original:a1'),s.entry);j.close();
});
test('existing-file open syncs file then directories; directory sync failure prevents usable recovery',async t=>{
  const s=await fixture(t);const first=s.open();first.put('original:a1',s.entry);first.close();
  const realSync=fs.fsyncSync,events=[];let fail=false;
  mock.method(fs,'fsyncSync',fd=>{
    const kind=fs.fstatSync(fd).isDirectory()?'directory':'file';events.push(kind);
    if(fail&&kind==='directory')throw Error('directory sync refused');
    return realSync(fd);
  });syncBuiltinESMExports();
  try {
    const j=s.open();j.close();assert.equal(events[0],'file');assert.equal(events.filter(e=>e==='directory').length>=2,true);
    const before=readFileSync(s.path);fail=true;assert.throws(s.open,/directory sync refused/);assert.deepEqual(readFileSync(s.path),before);
  } finally {mock.restoreAll();syncBuiltinESMExports();}
});
test('lost lock prevents persistence and poisons the handle',async t=>{
  const s=await fixture(t),j=s.open();const before=readFileSync(s.path);s.lock.held=false;
  assert.throws(()=>j.put('original:a1',s.entry),/exclusive journal lock/);s.lock.held=true;
  assert.throws(()=>j.put('original:a1',s.entry),/unavailable/);assert.deepEqual(readFileSync(s.path),before);j.close();
});
test('foreign bytes, fields and initial verified markers are refused before append',async t=>{
  for(const change of [{ciphertext:[99]},{name:'Private Name'},{phase:'verified'}]){
    const s=await fixture(t),j=s.open(),before=readFileSync(s.path);
    assert.throws(()=>j.put('original:a1',{...s.entry,...change}));assert.deepEqual(readFileSync(s.path),before);j.close();
  }
});
test('verified phases never regress and returned entries cannot mutate receipts',async t=>{
  const s=await fixture(t),j=s.open();j.put('original:a1',s.entry);j.put('original:a1',{...s.entry,phase:'verified'});
  j.get('original:a1').ciphertext[0]=99;assert.deepEqual(j.get('original:a1').ciphertext,[2]);
  assert.throws(()=>j.put('original:a1',s.entry),/regressed/);j.close();
});
test('partial append is retained and refuses reopen or automatic repair',async t=>{
  const s=await fixture(t),j=s.open();j.put('original:a1',s.entry);j.close();appendFileSync(s.path,'{"partial":');
  const before=readFileSync(s.path);assert.throws(s.open,/Interrupted/);assert.deepEqual(readFileSync(s.path),before);
});
test('changed chain and wrong original plan refuse reopen',async t=>{
  const s=await fixture(t),j=s.open();j.put('original:a1',s.entry);j.close();
  const saved=readFileSync(s.path,'utf8');writeFileSync(s.path,saved.replace('"sequence":1','"sequence":2'));
  assert.throws(s.open,/chain changed/);writeFileSync(s.path,saved.replace(s.artifact.hash,'c'.repeat(64)));
  assert.throws(s.open,/original plan changed/);
});
test('concurrent disk change stops appends without overwriting foreign bytes',async t=>{
  const s=await fixture(t),j=s.open();appendFileSync(s.path,'foreign\n');const before=readFileSync(s.path);
  assert.throws(()=>j.put('original:a1',s.entry),/Journal changed/);assert.deepEqual(readFileSync(s.path),before);j.close();
});
test('symlink and oversized file are rejected without truncation',async t=>{
  const s=await fixture(t),target=s.path+'.target';writeFileSync(target,'untouched');symlinkSync(target,s.path);
  assert.throws(s.open);assert.equal(readFileSync(target,'utf8'),'untouched');rmSync(s.path);
  writeFileSync(s.path,'', {mode:0o600});truncateSync(s.path,MAX_EXECUTION_JOURNAL_BYTES+1);
  assert.throws(s.open,/bounded/);assert.equal(statSync(s.path).size,MAX_EXECUTION_JOURNAL_BYTES+1);
});