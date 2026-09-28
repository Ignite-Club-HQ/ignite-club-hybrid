import assert from 'node:assert/strict';
const base='http://127.0.0.1:5180';
const root=await fetch(base); assert.equal(root.status,200);
assert(root.headers.get('content-security-policy').includes("connect-src 'self'"));
const html=await root.text(); assert(!/<script[^>]*>\s*[^<\s]/.test(html), 'Unexpected inline executable script');
const main=await fetch(base+'/src/main.tsx'); assert.equal(main.status,200);
const blocked=await fetch(base+'/src/App.tsx'); assert.equal(blocked.status,500);
const live=process.argv[2]==='--icp';
const local=await fetch(base+'/icp/api/v2/status'); assert.equal(local.status,live ? 200 : 503);
if (live) {
  const config=await fetch(base+'/icp/api/v2/lab-config'); assert.equal(config.status,200);
  const value=await config.json(); assert.deepEqual(Object.keys(value).sort(),['canisterId','network','rootKey']);
  assert.equal(value.network,'local'); assert.equal(config.headers.get('cache-control'),'no-store');
}
console.log(`Dev server smoke passed: CSP, entry point, unported App blocked, ${live ? 'local ICP connected' : 'absent ICP fails locally'}.`);
