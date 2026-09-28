import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import {
  resolveClubBackend,
  type BackendProviders,
} from '../src/lab/backendRouter';
import type { PlacementRegistry } from '../src/lab/hybridClubLinksService';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

type Child = {
  id: string;
  parentId: string;
  name: string;
  teamId: string;
};

type Invite = {
  id: string;
  clubId: string;
  teamId: string;
  recipientId: string;
  status: 'pending' | 'accepted';
  childIds: string[];
};

type InviteClient = {
  createInvite(
    actorId: string,
    clubId: string,
    teamId: string,
    recipientId: string,
    childNames: string[],
  ): Promise<Invite>;
  acceptInvite(actorId: string, inviteId: string): Promise<Invite>;
  getChildren(parentId: string): Promise<Child[]>;
  hasTeamMembership(parentId: string, teamId: string): Promise<boolean>;
};

const CLUB_A = 'club-parent-invite-a';
const CLUB_B = 'club-parent-invite-b';
const TEAM_A = 'team-parent-invite-a';
const TEAM_B = 'team-parent-invite-b';
const ADMIN_A = 'parent-invite-admin-a';
const PARENT_A = 'parent-invite-a';
const ATTACKER_B = 'parent-invite-attacker-b';

function createInviteClient(): InviteClient {
  const invites = new Map<string, Invite>();
  const children = new Map<string, Child>();
  const memberships = new Set<string>();
  return {
    async createInvite(actorId, clubId, teamId, recipientId, childNames) {
      if (actorId !== ADMIN_A || clubId !== CLUB_A) throw new Error('Club admin required');
      const invite = {
        id: `invite-${invites.size + 1}`,
        clubId,
        teamId,
        recipientId,
        status: 'pending' as const,
        childIds: [],
      };
      invite.childIds = childNames.map((name, index) => {
        const id = `${invite.id}-child-${index + 1}`;
        children.set(id, { id, parentId: recipientId, name: name.trim(), teamId });
        return id;
      });
      invites.set(invite.id, invite);
      return invite;
    },
    async acceptInvite(actorId, inviteId) {
      const invite = invites.get(inviteId);
      if (!invite || invite.recipientId !== actorId) throw new Error('Invite recipient required');
      if (invite.status === 'accepted') return invite;
      invite.status = 'accepted';
      memberships.add(`${actorId}:${invite.teamId}`);
      return invite;
    },
    async getChildren(parentId) {
      return [...children.values()].filter(child => child.parentId === parentId);
    },
    async hasTeamMembership(parentId, teamId) {
      return memberships.has(`${parentId}:${teamId}`);
    },
  };
}

async function routedClient(
  registry: PlacementRegistry,
  providers: BackendProviders<InviteClient>,
  clients: Map<string, InviteClient>,
  clubId: string,
) {
  const routed = await resolveClubBackend(registry, clubId);
  const key = routed.kind === 'icp'
    ? `icp:${routed.backend.Icp.canister.toText()}`
    : `supabase:${routed.backend.Supabase.environment}`;
  let client = clients.get(key);
  if (!client) {
    client = routed.kind === 'icp'
      ? await providers.icp(routed.backend.Icp.canister)
      : await providers.supabase(routed.backend.Supabase.environment);
    clients.set(key, client);
  }
  return client;
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`preserves atomic parent invite acceptance in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([
      {
        clubId: CLUB_A,
        country: 'AU',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'parent-invite-au' } }
          : { Icp: { canister: Principal.fromText('aaaaa-aa') } },
      },
      {
        clubId: CLUB_B,
        country: 'US',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'parent-invite-us' } }
          : { Icp: { canister: Principal.fromText('2vxsx-fae') } },
      },
    ]);
    const calls: string[] = [];
    const clients = new Map<string, InviteClient>();
    const getClient = (key: string) => {
      let client = clients.get(key);
      if (!client) {
        client = createInviteClient();
        clients.set(key, client);
      }
      return client;
    };
    const providers: BackendProviders<InviteClient> = {
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return getClient(`supabase:${environment}`);
      },
      icp: async canister => {
        calls.push(`icp:${canister.toText()}`);
        return getClient(`icp:${canister.toText()}`);
      },
    };
    const client = await routedClient(registry, providers, clients, CLUB_A);
    const otherClubClient = await routedClient(registry, providers, clients, CLUB_B);

    const invite = await client.createInvite(
      ADMIN_A,
      CLUB_A,
      TEAM_A,
      PARENT_A,
      [' Synthetic Child One ', 'Synthetic Child Two'],
    );
    await expect(client.acceptInvite(ATTACKER_B, invite.id))
      .rejects.toThrow('Invite recipient required');
    await expect(client.acceptInvite(PARENT_A, invite.id)).resolves.toMatchObject({
      status: 'accepted',
      childIds: [`${invite.id}-child-1`, `${invite.id}-child-2`],
    });
    await expect(client.acceptInvite(PARENT_A, invite.id)).resolves.toMatchObject({ status: 'accepted' });
    await expect(client.getChildren(PARENT_A)).resolves.toEqual([
      { id: `${invite.id}-child-1`, parentId: PARENT_A, name: 'Synthetic Child One', teamId: TEAM_A },
      { id: `${invite.id}-child-2`, parentId: PARENT_A, name: 'Synthetic Child Two', teamId: TEAM_A },
    ]);
    await expect(client.hasTeamMembership(PARENT_A, TEAM_A)).resolves.toBe(true);
    await expect(otherClubClient.getChildren(PARENT_A)).resolves.toEqual([]);
    await expect(otherClubClient.hasTeamMembership(PARENT_A, TEAM_B)).resolves.toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.startsWith(mode === 'supabase' ? 'supabase:' : 'icp:'))).toBe(true);
  });
}

test('does not fall back to Supabase when the selected ICP invite provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } },
  }]);
  const providers: BackendProviders<InviteClient> = {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP invite provider unavailable');
    },
  };

  await expect(routedClient(registry, providers, new Map(), CLUB_A))
    .rejects.toThrow('local ICP invite provider unavailable');
  expect(supabaseCalls).toBe(0);
});
