// Exact separate source-grant orchestration for the operator. It is not wired
// to mainnet upgrades until legacy source inventory/release acceptance exists.
const canonical = value => {
  if (typeof value === 'bigint') return String(value);
  if (value?.toText) return value.toText();
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
};
export const fingerprint = value => JSON.stringify(canonical(value));
const unwrap = reply => { if (!reply || typeof reply !== 'object' || 'Err' in reply) throw new Error(reply?.Err ?? 'Invalid directory configuration reply'); return reply.Ok; };

export async function configureDirectorySources(binding, sources, generation, transport) {
  if (typeof generation !== 'bigint' || generation < 1n || !sources.length || sources.length > 4096 ||
      new Set(sources.map(s => s.groupId)).size !== sources.length || new Set(sources.map(s => s.authority.toText())).size !== sources.length)
    throw new Error('Exact complete directory sources required');
  if (!transport.identity?.toText?.()) throw new Error('Pinned directory identity required');
  await transport.gate();
  // Identity verifies two complete consensus registries; missing unregistered
  // legacy sources refuse here, never configure the remaining partial set.
  await transport.persist({ phase: 'pending', source: 'identity', binding, generation, sources });
  const grants = unwrap(await transport.configure(binding, sources.map(s => s.authority), generation));
  await transport.gate();
  if (!Array.isArray(grants) || grants.length !== sources.length || new Set(grants.map(g => g.group)).size !== sources.length) throw new Error('Exact source grant inventory required');
  const digest = grants[0]?.inventory_digest;
  if (!digest || digest.length !== 32) throw new Error('Directory inventory digest required');
  for (const source of sources) {
    const grant = grants.find(g => g.group === source.groupId);
    if (!grant || grant.generation !== generation || grant.router.toText() !== binding.registry.toText() ||
        grant.identity.toText() !== transport.identity.toText() ||
        grant.deployment !== binding.target_alias || fingerprint(grant.inventory_digest) !== fingerprint(digest)) throw new Error('Foreign directory source grant');
  }
  const expected = sources.map(s => [s.groupId, s.authority.toText()]).sort();
  const checkIdentity = config => {
    const observed = config.sources?.map(([group, authority]) => [group, authority.toText()]).sort();
    if (config.enabled !== true || config.app_enabled !== false || config.generation !== generation || fingerprint(config.binding) !== fingerprint(binding) ||
        fingerprint(observed) !== fingerprint(expected) || fingerprint(config.inventory_digest) !== fingerprint(digest)) throw new Error('Identity directory configuration readback changed');
  };
  checkIdentity(unwrap(await transport.configuration()));
  await transport.persist({ phase: 'complete', source: 'identity', binding, generation, sources, grants });
  for (const source of sources) {
    const grant = grants.find(g => g.group === source.groupId);
    await transport.gate();
    const prior = unwrap(await transport.sourceConfiguration(source));
    if (prior.binding?.length) {
      if (!prior.enabled || fingerprint(prior.binding[0]) !== fingerprint(grant)) throw new Error('Existing directory source binding differs; fenced replacement required');
    } else {
      // Only idempotent exact configuration is retry-safe. Durable intent and
      // immutable readback must be supplied by the protected release transport.
      await transport.persist({ source: source.groupId, grant, phase: 'pending' });
      unwrap(await transport.configureSource(source, grant));
    }
    const after = unwrap(await transport.sourceConfiguration(source));
    await transport.gate();
    if (!after.enabled || fingerprint(after.binding?.[0]) !== fingerprint(grant)) throw new Error('Directory source configuration readback failed');
    await transport.persist({ source: source.groupId, grant, phase: 'complete' });
  }
  // Recheck all bindings after the last awaited configure. A previously read
  // source may have been disabled by another operator while later calls ran.
  for (const source of sources) {
    const grant = grants.find(g => g.group === source.groupId);
    const final = unwrap(await transport.sourceConfiguration(source));
    if (!final.enabled || fingerprint(final.binding?.[0]) !== fingerprint(grant)) throw new Error('Final directory source binding changed');
  }
  checkIdentity(unwrap(await transport.configuration()));
  await transport.gate();
  return { grants, appEnabled: false, ready: false };
}