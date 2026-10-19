/** Local rehearsal only. No runtime/UI switch can opt a remote host in. */
export function isLoopbackRehearsalHost(host) {
  try {
    const url = new URL(host);
    return ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username && !url.password;
  } catch { return false; }
}

/** Bind only exact-signature additive consensus twins from the real Candid
 * service. Keep writes/control-plane methods intact; never retry/fallback. */
export function adaptLocalAccountReads(actor, service, host) {
  if (!isLoopbackRehearsalHost(host)) throw new Error('Protected-read rehearsal requires a loopback host');
  const fields = new Map(service._fields);
  const mapped = new Map();
  for (const [name, signature] of fields) {
    if (!name.startsWith('read_account_')) continue;
    const legacyName = name.slice('read_account_'.length);
    const legacy = fields.get(legacyName);
    if (!legacy) continue;
    const types = sig => JSON.stringify([sig.argTypes.map(t => t.display()), sig.retTypes.map(t => t.display())]);
    if (types(signature) !== types(legacy) || signature.annotations.includes('query') || signature.annotations.includes('composite_query')) {
      throw new Error(`Incompatible protected read: ${name}`);
    }
    mapped.set(legacyName, name);
  }
  return new Proxy(actor, {
    get(target, property) {
      const protectedName = mapped.get(property);
      if (protectedName) {
        const method = Reflect.get(target, protectedName);
        if (typeof method !== 'function') throw new Error(`Missing protected read: ${protectedName}`);
        return method.bind(target);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}