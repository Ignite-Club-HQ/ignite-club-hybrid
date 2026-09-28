import { expect, test } from 'vitest';
import { createSyntheticAccountLinking } from '../src/lab/syntheticAccountLinking';

test('links multiple principals to one account and preserves legacy mapping', () => {
  const accounts = createSyntheticAccountLinking();
  accounts.create('acct-1', 'supabase-uuid-1');
  accounts.link('acct-1', 'ii-principal-a', 0n);
  accounts.link('acct-1', 'ii-principal-b', 1n);
  expect(accounts.owner('ii-principal-a')).toBe('acct-1');
  expect(accounts.owner('ii-principal-b')).toBe('acct-1');
});

test('rejects duplicate ownership and protects the last credential', () => {
  const accounts = createSyntheticAccountLinking();
  accounts.create('acct-1'); accounts.create('acct-2');
  accounts.link('acct-1', 'ii-principal-a', 0n);
  accounts.link('acct-1', 'ii-principal-b', 1n);
  expect(() => accounts.link('acct-2', 'ii-principal-a', 0n)).toThrow('Principal already linked');
  expect(() => accounts.revoke('acct-1', 'outsider', 'ii-principal-b', 2n)).toThrow('not linked');
  accounts.revoke('acct-1', 'ii-principal-a', 'ii-principal-b', 2n);
  expect(() => accounts.revoke('acct-1', 'ii-principal-a', 'ii-principal-a', 3n)).toThrow('last principal');
  expect(() => accounts.revoke('acct-1', 'ii-principal-a', 'ii-principal-b', 1n)).toThrow('Account version conflict');
});

test('requires a verified target ceremony, expires challenges, and isolates sessions', () => {
  const accounts = createSyntheticAccountLinking();
  accounts.create('acct-1');
  accounts.link('acct-1', 'issuer', 0n);
  const challenge = accounts.begin('acct-1', 'issuer', 'target', 1n, 1000);
  expect(() => accounts.accept(challenge.id, 'other', 1001)).toThrow('Invalid or expired');
  expect(() => accounts.accept(challenge.id, 'target', 601001)).toThrow('Invalid or expired');
  const valid = accounts.begin('acct-1', 'issuer', 'target', 1n, 2000);
  const linked = accounts.accept(valid.id, 'target', 2001);
  expect(linked.version).toBe(2n);
  expect(accounts.session('acct-1', 'issuer').cacheKey).not.toBe(accounts.session('acct-1', 'target').cacheKey);
  expect(() => accounts.session('acct-1', 'revoked')).toThrow('not linked');
});
