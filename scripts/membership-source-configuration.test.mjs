import test from 'node:test';
import assert from 'node:assert/strict';
import { configureDirectorySources } from './membership-source-configuration.mjs';
const p = text => ({ toText: () => text, toJSON: () => text });
const binding = { registry: p('router'), target_alias: 'mainnet' }, generation = 2n;
const sources = ['g1', 'g2'].map(groupId => ({ groupId, authority: p(`${groupId}-club`) }));
const grants = sources.map(s => ({ group: s.groupId, router: binding.registry, identity: p('identity'), deployment: 'mainnet', generation, inventory_digest: Array(32).fill(1) }));
function transport() {
  const stored = new Map(), calls = [];
  return { calls, stored, identity: p('identity'), gate: async () => {}, configure: async () => ({ Ok: grants }),
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

test('late disablement is rejected after all source configurations finish', async () => {
  const t = transport();const read = t.sourceConfiguration;let n = 0;
  t.sourceConfiguration = async s => { n++; if (n === 5) return { Ok: { enabled: false, binding: [grants[0]] } }; return read(s); };
  await assert.rejects(() => configureDirectorySources(binding, sources, generation, t), /Final/);
});
test('consistently foreign identity grants refuse before any source writes', async () => {
  const t = transport();t.configure = async () => ({ Ok: grants.map(g => ({ ...g, identity: p('foreign') })) });
  await assert.rejects(() => configureDirectorySources(binding, sources, generation, t), /Foreign/);assert.deepEqual(t.calls, []);
});
test('late identity configuration changes refuse after source readbacks', async () => {
  for (const field of ['enabled', 'app_enabled', 'generation', 'inventory_digest']) {
    const t = transport(), read = t.configuration;let n = 0;
    t.configuration = async () => {const r = await read();if (++n === 2) r.Ok[field] = field === 'enabled' ? false : field === 'app_enabled' ? true : field === 'generation' ? 3n : Array(32).fill(2);return r;};
    await assert.rejects(() => configureDirectorySources(binding, sources, generation, t), /Identity.*changed/);
  }
});