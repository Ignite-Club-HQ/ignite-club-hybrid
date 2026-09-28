export type SyntheticAccount = { accountId: string; legacySupabaseUserId?: string; principals: Set<string>; version: bigint };
type Challenge = { id: string; accountId: string; issuer: string; target: string; expectedVersion: bigint; expiresAtMs: number; accepted: boolean };

/** Synthetic account-linking model; no real authentication or identities are accepted. */
export function createSyntheticAccountLinking() {
  const accounts = new Map<string, SyntheticAccount>();
  const principalOwners = new Map<string, string>();
  const challenges = new Map<string, Challenge>();
  let nextChallenge = 0;
  const get = (accountId: string) => accounts.get(accountId) ?? (() => { throw new Error('Account not found'); })();
  const requireSigner = (accountId: string, principal: string) => {
    const account = get(accountId);
    if (!account.principals.has(principal)) throw new Error('Principal is not linked');
    return account;
  };
  return {
    create(accountId: string, legacySupabaseUserId?: string) {
      if (!accountId || accounts.has(accountId)) throw new Error('Account already exists');
      const account = { accountId, legacySupabaseUserId, principals: new Set<string>(), version: 0n };
      accounts.set(accountId, account); return account;
    },
    link(accountId: string, principal: string, expectedVersion: bigint) {
      const account = get(accountId);
      if (account.version !== expectedVersion) throw new Error('Account version conflict');
      const owner = principalOwners.get(principal);
      if (owner && owner !== accountId) throw new Error('Principal already linked');
      if (account.principals.has(principal)) return account;
      account.principals.add(principal); principalOwners.set(principal, accountId); account.version += 1n; return account;
    },
    begin(accountId: string, issuer: string, target: string, expectedVersion: bigint, nowMs: number) {
      const account = requireSigner(accountId, issuer);
      if (!target || principalOwners.has(target)) throw new Error('Principal already linked');
      if (account.version !== expectedVersion) throw new Error('Account version conflict');
      const id = `challenge-${++nextChallenge}`;
      challenges.set(id, { id, accountId, issuer, target, expectedVersion, expiresAtMs: nowMs + 600_000, accepted: false });
      return { id, expiresAtMs: nowMs + 600_000 };
    },
    accept(id: string, target: string, nowMs: number) {
      const challenge = challenges.get(id);
      if (!challenge || challenge.target !== target || nowMs >= challenge.expiresAtMs) throw new Error('Invalid or expired challenge');
      const account = get(challenge.accountId);
      if (challenge.accepted) return account;
      if (principalOwners.has(target) || !account.principals.has(challenge.issuer) || account.version !== challenge.expectedVersion) {
        throw new Error('Link authorization changed');
      }
      account.principals.add(target);
      principalOwners.set(target, account.accountId);
      account.version += 1n;
      challenge.accepted = true;
      return account;
    },
    revoke(accountId: string, actor: string, principal: string, expectedVersion: bigint) {
      const account = requireSigner(accountId, actor);
      if (account.version !== expectedVersion) throw new Error('Account version conflict');
      if (!account.principals.has(principal)) throw new Error('Principal not linked');
      if (account.principals.size === 1) throw new Error('Cannot revoke the last principal');
      account.principals.delete(principal); principalOwners.delete(principal); account.version += 1n; return account;
    },
    session(accountId: string, principal: string) {
      const account = requireSigner(accountId, principal);
      return { accountId, principal, cacheKey: `${accountId}:${principal}:${account.version}` };
    },
    owner(principal: string) { return principalOwners.get(principal); },
  };
}
