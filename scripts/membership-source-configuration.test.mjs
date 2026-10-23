import test from 'node:test';
import assert from 'node:assert/strict';
import { configureDirectorySources } from './membership-source-configuration.mjs';
const p = text => ({ toText: () => text, toJSON: () => text });
const binding = { registry: p('router'), target_alias: 'mainnet' }, generation = 2n;
const sources = ['g1', 'g2'].map(groupId => ({ groupId, authority: p(`${groupId}-club`) }));
const grants = sources.map(s => ({ group: s.groupId, router: binding.registry, identity: p('identity'), deployment: 'mainnet', generation, inventory_digest: Array(32).fill(1) }));
function transport() {
  const stored = new Map(), calls = [];
  return { calls, stored, gate: async () => {}, configure: async () => ({ Ok: grants }),
    configuration: async () => ({ Ok: { binding, generation, sources: sources.map(s => [s.groupId, s.authority]), inventory_digest: grants[0].inventory_digest, enabled: true, app_enabled: false } }),
    sourceConfiguration: async s => ({ Ok: stored.get(s.groupId) ?? { enabled: false, binding: [] } }),
    configureSource: async (s, grant) => { calls.push(s.groupId); stored.set(s.groupId, { enabled: true, binding: [grant] }); return { Ok: null }; },
    persist: async () => {},
  };
}
test('configures exact separate grants, reads them back and resumes without replay', async () => {
  const t = transport();const result = await configureDirectorySources(binding, sources, generation, t);
  assert.deepEqual(t.calls, ['g1', 'g2']);assert.equal(result.appEnabled, false);assert.equal(result.ready, false);
  await configureDirectorySources(binding, sources, generation, t);assert.deepEqual(t.calls, ['g1', 'g2']);
});
test('missing legacy inventory refuses before changing any source', async () => {
  const t = transport();t.configure = async () => ({ Err: 'Exact complete authority inventory required' });
  await assert.rejects(() => configureDirectorySources(binding, sources, generation, t), /inventory/);assert.deepEqual(t.calls, []);
});
test('foreign grants, partial readback and mismatched old sources cannot authorize configuration', async () => {
  const foreign = transport();foreign.configure = async () => ({ Ok: [grants[0]] });
  await assert.rejects(() => configureDirectorySources(binding, sources, generation, foreign), /inventory/);
  const old = transport();old.stored.set('g1', { enabled: true, binding: [{ ...grants[0], generation: 1n }] });
  await assert.rejects(() => configureDirectorySources(binding, sources, generation, old), /differs/);assert.deepEqual(old.calls, []);
});
test('unknown persistence stops before source mutation', async () => {
  const t = transport();t.persist = async () => { throw Error('Unknown journal write'); };
  await assert.rejects(() => configureDirectorySources(binding, sources, generation, t), /Unknown/);assert.deepEqual(t.calls, []);
});