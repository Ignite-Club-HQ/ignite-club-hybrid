import { expect, test, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createIdentityAccessClient } from '../src/lab/identityAccessClient';
import type { _SERVICE } from '../src/lab/bindings/identity_access/declarations/identity_access.did';

const account = { id: 'account-1', principals: [Principal.fromText('aaaaa-aa')], version: 0n };
const accessScoped = vi.fn(async () => ({ Ok: { account_id: account.id, app_admin: false, club_admin: true, guardian: false, team_member: true } }));
const grantRoleScoped = vi.fn(async () => ({ Ok: null }));
const exportState = vi.fn(async () => ({
  Ok: {
    schema: 1,
    governor: Principal.fromText('aaaaa-aa'),
    accounts: [account],
    roles: [{ account_id: account.id, role: 'club_admin', club: ['club-a'], team: [], site_id: [] }],
    exclusions: [],
    family_links: [],
    privacy_consents: [],
    external_bindings: [],
    link_challenges: [],
  },
}));
const actor = {
  whoami: async () => ({ Ok: account }),
  register_account: async () => ({ Ok: account }),
  access: async () => ({ Ok: { account_id: account.id, app_admin: false, club_admin: true, guardian: false, team_member: true } }),
  access_scoped: accessScoped,
  grant_role_scoped: grantRoleScoped,
  set_family: async () => ({ Ok: null }),
  set_exclusion_scoped: async () => ({ Ok: null }),
  get_privacy_consent: async () => ({ Ok: true }),
  set_privacy_consent: async () => ({ Ok: { account_id: account.id, purpose: 'communications', granted: true, updated_at_ns: 1n } }),
  begin_link: async () => ({ Err: 'synthetic denial' }),
  accept_link: async () => ({ Err: 'synthetic denial' }),
  revoke: async () => ({ Err: 'synthetic denial' }),
  export_state: exportState,
} as unknown as _SERVICE;

test('identity access client converts successful decisions and preserves canister errors', async () => {
  const client = createIdentityAccessClient(actor);
  await expect(client.whoami()).resolves.toEqual(account);
  await expect(client.access('club-a', 'team-a', 'child-a')).resolves.toMatchObject({ club_admin: true, team_member: true });
  await expect(client.accessScoped('site-a', 'club-a', 'team-a', 'child-a')).resolves.toMatchObject({ club_admin: true });
  expect(accessScoped).toHaveBeenCalledWith(['site-a'], ['club-a'], ['team-a'], ['child-a']);
  await expect(client.grantRole('account-2', 'coach', 'club-a', 'team-a', 'site-a')).resolves.toBeNull();
  expect(grantRoleScoped).toHaveBeenCalledWith('account-2', 'coach', ['site-a'], ['club-a'], ['team-a']);
  await expect(client.exportState()).resolves.toMatchObject({ roles: [{ account_id: account.id, role: 'club_admin' }] });
  expect(exportState).toHaveBeenCalledOnce();
  await expect(client.beginLink(Principal.fromText('2ibo7-dia'))).rejects.toThrow('synthetic denial');
});

test('disposed identity access client rejects late and future calls', async () => {
  const client = createIdentityAccessClient(actor);
  client.dispose();
  await expect(client.whoami()).rejects.toThrow('Identity changed');
});
