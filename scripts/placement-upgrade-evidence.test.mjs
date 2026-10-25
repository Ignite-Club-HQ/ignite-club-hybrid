import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {placementOperatorEvidenceIdl,normalizePlacementOperatorEvidence} from './placement-upgrade-evidence.mjs';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {IDL}=require('@icp-sdk/core/candid');
const {Principal}=require('@icp-sdk/core/principal');
const record=IDL.Record({user:IDL.Principal,roles:IDL.Vec(IDL.Variant({Auditor:IDL.Null,PlacementAdmin:IDL.Null,SecurityAdmin:IDL.Null,InfrastructureAdmin:IDL.Null,MigrationOperator:IDL.Null}))});
const service=placementOperatorEvidenceIdl(IDL);
const replyType=service._fields.find(([name])=>name==='get_operator')[1].retTypes[0];
const user=Principal.fromText('vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae');
const row={user,roles:[{SecurityAdmin:null},{Auditor:null}]};
test('live optional operator reply decodes and retains exact user and roles',()=>{
  const type=IDL.Variant({Ok:IDL.Opt(record),Err:IDL.Text});
  const [reply]=IDL.decode([replyType],IDL.encode([type],[{Ok:[row]}]));
  assert.deepEqual(normalizePlacementOperatorEvidence(reply),{user:user.toText(),roles:['Auditor','SecurityAdmin']});
});
test('historical required operator reply yields identical canonical evidence',()=>{
  const type=IDL.Variant({Ok:record,Err:IDL.Text});
  const [reply]=IDL.decode([replyType],IDL.encode([type],[{Ok:row}]));
  assert.deepEqual(normalizePlacementOperatorEvidence(reply),{user:user.toText(),roles:['Auditor','SecurityAdmin']});
});
test('missing operator is explicit absence and never invents governor privileges',()=>{
  const [reply]=IDL.decode([replyType],IDL.encode([replyType],[{Ok:[]} ]));
  assert.equal(normalizePlacementOperatorEvidence(reply),null);
});
test('refused or malformed evidence stops instead of assuming privileges',()=>{
  for(const reply of [{Err:'Denied'},{Ok:[row,row]},{Ok:[{user,roles:[{Unknown:null}]}]},null])assert.throws(()=>normalizePlacementOperatorEvidence(reply));
});