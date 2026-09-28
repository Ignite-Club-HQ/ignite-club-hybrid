import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import {
  resolveClubBackend,
  type BackendProviders,
} from '../src/lab/backendRouter';
import type { PlacementRegistry } from '../src/lab/hybridClubLinksService';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

type GuardianInvite = {
  id: string;
  clubId: string;
  teamId: string;
  childId: string;
  recipientId: string;
  status: 'pending' | 'accepted';
  guardianId?: string;
};

type GuardianInviteClient = {
  createInvite(
    actorId: string,
    clubId: string,
    teamId: string,
    childId: string,
    recipientId: string,
  ): Promise<GuardianInvite>;
  acceptInvite(actorId: string, inviteId: string, childId: string): Promise<GuardianInvite>;
  getInvite(inviteId: string): Promise<GuardianInvite | undefined>;
  guardianCount(childId: string): Promise<number>;
};

const CLUB_A = 'club-guardian-invite-a';
const CLUB_B = 'club-guardian-invite-b';
const TEAM_A = 'team-guardian-invite-a';
const CHILD_A = 'child-guardian-invite-a';
const ADMIN_A = 'guardian-admin-a';
const MEMBER_A = 'guardian-member-a';
const OUTSIDER_B = 'guardian-outsider-b';

function createGuardianInviteClient(): GuardianInviteClient {
  const invites = new Map<string, GuardianInvite>();
  const guardians = new Set<string>();
  return {
    async createInvite(actorId, clubId, teamId, childId, recipientId) {
      if (actorId !== ADMIN_A || clubId !== CLUB_A) throw new Error('Club admin required');
      const invite = {
        id: `guardian-invite-${invites.size + 1}`,
        clubId,
        teamId,
        childId,
        recipientId,
        status: 'pending' as const,
      };
      invites.set(invite.id, invite);
      return invite;
    },
    async acceptInvite(actorId, inviteId, childId) {
      const invite = invites.get(inviteId);
      if (!invite || invite.recipientId !== actorId) throw new Error('Invite recipient required');
      if (invite.childId !== childId) throw new Error('Child is not part of this invite');
      if (invite.status === 'accepted') throw new Error('Invite already accepted');
      invite.status = 'accepted';
      invite.guardianId = actorId;
      guardians.add(`${childId}:${actorId}`);
      return invite;
    },
    async getInvite(inviteId) {
      return invites.get(inviteId);
    },
    async guardianCount(childId) {
      return [...guardians].filter(key => key.startsWith(`${childId}:`)).length;
    },
  };
}

async function routedClient(
  registry: PlacementRegistry,
  providers: BackendProviders<GuardianInviteClient>,
  clients: Map<string, GuardianInviteClient>,
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
  test(`serializes concurrent guardian invite acceptance in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([
      {
        clubId: CLUB_A,
        country: 'AU',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'guardian-invite-au' } }
          : { Icp: { canister: Principal.fromText('aaaaa-aa') } },
      },
      {
        clubId: CLUB_B,
        country: 'US',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'guardian-invite-us' } }
          : { Icp: { canister: Principal.fromText('2vxsx-fae') } },
      },
    ]);
    const calls: string[] = [];
    const clients = new Map<string, GuardianInviteClient>();
    const getClient = (key: string) => {
      let client = clients.get(key);
      if (!client) {
        client = createGuardianInviteClient();
        clients.set(key, client);
      }
      return client;
    };
    const providers: BackendProviders<GuardianInviteClient> = {
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
    const invite = await client.createInvite(ADMIN_A, CLUB_A, TEAM_A, CHILD_A, MEMBER_A);

    const attempts = await Promise.allSettled([
      client.acceptInvite(MEMBER_A, invite.id, CHILD_A),
      client.acceptInvite(MEMBER_A, invite.id, CHILD_A),
    ]);
    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1);
    await expect(client.getInvite(invite.id)).resolves.toMatchObject({ status: 'accepted', guardianId: MEMBER_A });
    await expect(client.guardianCount(CHILD_A)).resolves.toBe(1);
    await expect(otherClubClient.getInvite(invite.id)).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.startsWith(mode === 'supabase' ? 'supabase:' : 'icp:'))).toBe(true);
  });

  test(`rejects unauthorized and invalid-child acceptance without partial state in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'guardian-invite-au' } }
        : { Icp: { canister: Principal.fromText('aaaaa-aa') } },
    }]);
    const calls: string[] = [];
    const clients = new Map<string, GuardianInviteClient>();
    const provider = async (key: string) => {
      calls.push(key);
      let client = clients.get(key);
      if (!client) {
        client = createGuardianInviteClient();
        clients.set(key, client);
      }
      return client;
    };
    const routed = await routedClient(registry, {
      supabase: environment => provider(`supabase:${environment}`),
      icp: canister => provider(`icp:${canister.toText()}`),
    }, clients, CLUB_A);
    const invite = await routed.createInvite(ADMIN_A, CLUB_A, TEAM_A, CHILD_A, MEMBER_A);

    await expect(routed.acceptInvite(OUTSIDER_B, invite.id, CHILD_A))
      .rejects.toThrow('Invite recipient required');
    await expect(routed.acceptInvite(MEMBER_A, invite.id, 'wrong-child'))
      .rejects.toThrow('Child is not part of this invite');
    await expect(routed.getInvite(invite.id)).resolves.toMatchObject({ status: 'pending' });
    await expect(routed.guardianCount(CHILD_A)).resolves.toBe(0);
    expect(calls).toHaveLength(1);
  });
}

test('does not fall back to Supabase when the selected ICP guardian invite provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } },
  }]);
  const providers: BackendProviders<GuardianInviteClient> = {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP guardian invite provider unavailable');
    },
  };

  await expect(routedClient(registry, providers, new Map(), CLUB_A))
    .rejects.toThrow('local ICP guardian invite provider unavailable');
  expect(supabaseCalls).toBe(0);
});
