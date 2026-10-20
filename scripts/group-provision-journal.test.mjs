import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClosedProvisionJournal } from './group-provision-journal.mjs';

const binding = { governor: 'operator', deploymentId: 'local', host: 'https://icp-api.io', networkKind: 'local', subnetId: 's1', proposalId: 'p' };
const initial = { id: 'p', groupId: 'g', deploymentId: 'local', subnetId: 's1', phase: 'approved', expectedRevision: 2n, canisters: {} };
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'provision-journal-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
test('durable approval precedes calls and bigint receipts survive closed-only resume', () => fixture(async directory => {
  await runClosedProvisionJournal(directory, binding, initial, async (p, checkpoint) => {
    assert.equal(JSON.parse(await readFile(join(directory, 'provision.json'), 'utf8')).provision.phase, 'approved');
    await checkpoint({ ...p, pending: { kind: 'configure', operation: 'setting' } });
    return { ...p, phase: 'registered' };
  });
  await assert.rejects(stat(join(directory, 'operator.lock')), { code: 'ENOENT' });
  await runClosedProvisionJournal(directory, binding, initial, async p => {
    assert.equal(p.expectedRevision, 2n); assert.equal(p.phase, 'registered'); return p;
  });
}));
test('lost committed reply retains durable intent and lock, preventing another operator', () => fixture(async directory => {
  let calls = 0;
  await assert.rejects(runClosedProvisionJournal(directory, binding, initial, async (p, checkpoint) => {
    await checkpoint({ ...p, pending: { kind: 'configure', operation: 'setting' } }); calls++; throw new Error('reply lost');
  }), /reply lost/);
  assert.equal(JSON.parse(await readFile(join(directory, 'provision.json'), 'utf8')).provision.pending.operation, 'setting');
  await assert.rejects(runClosedProvisionJournal(directory, binding, initial, async () => { calls++; }), /locked/);
  assert.equal(calls, 1);
}));
test('checkpoint persistence failure retains the exclusive operator lock', () => fixture(async directory => {
  await assert.rejects(runClosedProvisionJournal(directory, binding, initial, async (p, checkpoint) => {
    await rm(join(directory, 'provision.json')); // make atomic destination replacement fail
    const { mkdir } = await import('node:fs/promises'); await mkdir(join(directory, 'provision.json'));
    await checkpoint({ ...p, pending: { kind: 'install' } });
  }));
  assert.ok(await stat(join(directory, 'operator.lock')));
}));
test('changed deployment host cannot reuse a prior operator receipt', () => fixture(async directory => {
  await runClosedProvisionJournal(directory, binding, initial, async p => ({ ...p, phase: 'registered' }));
  let called = false;
  await assert.rejects(runClosedProvisionJournal(directory, { ...binding, host: 'https://other.example' }, initial, async p => { called = true; return p; }), /binding mismatch/);
  assert.equal(called, false);
}));
test('incomplete or activated result never releases a provisioning lock', () => fixture(async directory => {
  await assert.rejects(runClosedProvisionJournal(directory, binding, initial, async p => ({ ...p, phase: 'enabled' })), /Closed complete registration/);
  assert.ok(await stat(join(directory, 'operator.lock')));
}));