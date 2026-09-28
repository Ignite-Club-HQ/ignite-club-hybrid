import test from 'node:test';
import assert from 'node:assert/strict';
import { permitsLocalRequest } from '../src/lab/networkGuard.mjs';
test('only same-origin ICP API proxy paths are permitted', () => {
  const origin='http://localhost:5180';
  assert.equal(permitsLocalRequest('/icp/api/v2/status',origin),true);
  assert.equal(permitsLocalRequest('/icp/api/v4/canister/test/call',origin),true);
  assert.equal(permitsLocalRequest(new URL('/icp/api/v3/canister/test/call', origin), origin),true);
  for (const url of ['https://production.invalid/icp/api/v2/status','http://localhost:4943/api/v2/status','/rest/v1/clubs','//outside.invalid/icp/api/v2/status','/icp/api/v2/../../../rest/v1','data:text/plain,test','http://user:password@localhost:5180/icp/api/v2/status','http://localhost:5180/icp/api/v2/status#fragment']) {
    assert.equal(permitsLocalRequest(url,origin),false,url);
  }
});
