import { expect, test } from 'vitest';
import { createIcpClubLinksService } from '../src/lab/icpClubLinksService';
import { validateLocalConfig, validateLocalLabConfig } from '../src/lab/localActor';
import type { _SERVICE } from '../src/lab/bindings/declarations/club_links.did';

test('a response arriving after identity disposal cannot populate the new session', async () => {
  let complete!: (value: unknown) => void;
  const actor = { list_links: () => new Promise(resolve => { complete = resolve; }) } as unknown as _SERVICE;
  const service = createIcpClubLinksService(actor);
  const pending = service.listAdmin('club');
  service.dispose();
  complete({ Ok: { revision: 1n, links: [] } });
  await expect(pending).rejects.toThrow('Identity changed');
  await expect(service.listAdmin('club')).rejects.toThrow('Identity changed');
});

test('an older query cannot replace a newer observed club revision', async () => {
  const replies = [2n, 1n];
  const actor = { list_links: async () => ({ Ok: { revision: replies.shift()!, links: [] } }) } as unknown as _SERVICE;
  const service = createIcpClubLinksService(actor);
  await service.listAdmin('club');
  await expect(service.listAdmin('club')).rejects.toThrow('Stale response');
});

test('missing or non-local actor configuration fails before making a request', () => {
  expect(() => validateLocalConfig({ network: 'ic' as 'local', canisterId: 'aaaaa-aa', rootKey: '00'.repeat(133) })).toThrow();
  expect(() => validateLocalConfig({ network: 'local', canisterId: 'aaaaa-aa', rootKey: '' })).toThrow();
  expect(() => validateLocalLabConfig({
    network: 'local',
    canisterId: 'rrkah-fqaaa-aaaaa-aaaaq-cai',
    identityAccessCanisterId: 'aaaaa-aa',
    rootKey: '00'.repeat(133),
  })).toThrow('identity access');
  expect(validateLocalLabConfig({
    network: 'local',
    canisterId: 'rrkah-fqaaa-aaaaa-aaaaq-cai',
    identityAccessCanisterId: 'rrkah-fqaaa-aaaaa-aaaaq-cai',
    internetIdentityCanisterId: 'rdmx6-jaaaa-aaaaa-aaadq-cai',
    internetIdentityAuthorizeUrl: 'http://id.ai.localhost:4943/authorize',
    rootKey: '00'.repeat(133),
  }).internetIdentityCanisterId).toBe('rdmx6-jaaaa-aaaaa-aaadq-cai');
  expect(() => validateLocalLabConfig({
    network: 'local',
    canisterId: 'rrkah-fqaaa-aaaaa-aaaaq-cai',
    identityAccessCanisterId: 'rrkah-fqaaa-aaaaa-aaaaq-cai',
    internetIdentityCanisterId: 'rdmx6-jaaaa-aaaaa-aaadq-cai',
    internetIdentityAuthorizeUrl: 'https://id.ai/authorize',
    rootKey: '00'.repeat(133),
  })).toThrow('Internet Identity authorize URL');
});
