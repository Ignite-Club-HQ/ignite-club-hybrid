/** Local rehearsal only. No runtime/UI switch can opt a remote host in. */
export function isLoopbackRehearsalHost(host) {
  try {
    const url = new URL(host);
    return ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username && !url.password;
  } catch { return false; }
}

/** Exact-signature additive consensus twins from the real Candid service. */
function exactSignatureTwins(service, onIncompatible) {
  const fields = new Map(service._fields);
  const mapped = new Map();
  for (const [name, signature] of fields) {
    if (!name.startsWith('read_account_')) continue;
    const legacyName = name.slice('read_account_'.length);
    const legacy = fields.get(legacyName);
    if (!legacy) continue;
    const types = sig => JSON.stringify([sig.argTypes.map(t => t.display()), sig.retTypes.map(t => t.display())]);
    if (types(signature) !== types(legacy) || signature.annotations.includes('query') || signature.annotations.includes('composite_query')) {
      onIncompatible(name);
      continue;
    }
    mapped.set(legacyName, name);
  }
  return mapped;
}

/** Bind only exact-signature additive consensus twins from the real Candid
 * service. Keep writes/control-plane methods intact; never retry/fallback. */
export function adaptLocalAccountReads(actor, service, host) {
  if (!isLoopbackRehearsalHost(host)) throw new Error('Protected-read rehearsal requires a loopback host');
  const mapped = exactSignatureTwins(service, name => { throw new Error(`Incompatible protected read: ${name}`); });
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

const PROTECTED_READ_TRAP = /protected consensus account read/i;
/** Canister-level capability memory: once a canister tells us a legacy query
 * needs the protected consensus read, go straight to the twin next time.
 * Keyed by canister + method; never holds user data, so sign-out need not
 * clear it. Kept on the device so each app launch skips the refused query
 * round trip (a canister that drops the gate still answers the twin). */
const DECISIONS_KEY = 'ignite_protected_read_decisions_v1';
const MAX_DECISIONS = 2000;
function loadDecisions() {
  try {
    const raw = globalThis.localStorage?.getItem(DECISIONS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter(k => typeof k === 'string' && k.length < 200).slice(-MAX_DECISIONS) : []);
  } catch { return new Set(); }
}
const protectedReadDecisions = loadDecisions();
function rememberDecision(key) {
  if (protectedReadDecisions.has(key)) return;
  protectedReadDecisions.add(key);
  try { globalThis.localStorage?.setItem(DECISIONS_KEY, JSON.stringify([...protectedReadDecisions].slice(-MAX_DECISIONS))); } catch { /* memory copy still works */ }
}

/** Live groups run with account admission enabled, which makes legacy
 * account-scoped queries trap with "Use protected consensus account read".
 * This adapter keeps the fast legacy query everywhere it still works and,
 * only when the canister itself refuses, retries that one call through its
 * exact-signature `read_account_` consensus twin (an update call). Canisters
 * without the gate never trap, so their behavior is unchanged. Methods
 * without an exact twin propagate the original error — no guessing. */
export function adaptRemoteAccountReads(actor, service, canisterId) {
  const mapped = exactSignatureTwins(service, () => {});
  if (mapped.size === 0 || typeof canisterId !== 'string' || !canisterId) return actor;
  return new Proxy(actor, {
    get(target, property) {
      const protectedName = mapped.get(property);
      const value = Reflect.get(target, property);
      if (!protectedName || typeof value !== 'function') {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      const twin = Reflect.get(target, protectedName);
      if (typeof twin !== 'function') return value.bind(target);
      if (protectedReadDecisions.has(`${canisterId}|${property}`)) return twin.bind(target);
      return async (...args) => {
        try {
          return await value.apply(target, args);
        } catch (e) {
          if (!PROTECTED_READ_TRAP.test(String((e && e.message) || e))) throw e;
          rememberDecision(`${canisterId}|${property}`);
          return twin.apply(target, args);
        }
      };
    },
  });
}