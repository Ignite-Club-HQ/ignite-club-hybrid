/** Lazy-load this explicit rehearsal API; nothing installs it in featureRouter.
 * Governor placement attestation is not independent subnet measurement.
 */
import type { FeatureBackendContext } from './featureRouter';
import { openGroupSession, type GroupRegistry } from './groupSession';
import { GROUP_DOMAINS, type GroupDomain } from './groupRouting';

export async function openLiveGroupReadSession(ctx: FeatureBackendContext) {
  const { connectLiveShardRouter, connectLiveClubDomain } = await import('./domains');
  const { actor: router } = await connectLiveShardRouter(ctx.target, ctx.identity);
  return openGroupSession(ctx, {
    async readRegistry(): Promise<GroupRegistry> {
      const reply = await router.read_group_registry(ctx.target.alias);
      if ('Err' in reply) throw new Error(reply.Err);
      const snapshot = reply.Ok; const first = snapshot.placements[0];
      if (!first) throw new Error('No complete group placement');
      for (const p of snapshot.placements) {
        if (p.deployment_id !== first.deployment_id || p.deployment_revision !== first.deployment_revision || p.host !== first.host ||
            p.network_kind !== first.network_kind || p.primary_subnet.toText() !== first.primary_subnet.toText() ||
            p.additional_subnets_enabled !== first.additional_subnets_enabled ||
            JSON.stringify(p.approved_subnets.map(s => s.toText()).sort()) !== JSON.stringify(first.approved_subnets.map(s => s.toText()).sort())) throw new Error('Mixed deployment registry');
      }
      if (first.network_kind !== 'public_mainnet' && first.network_kind !== 'cloud_engine') throw new Error('Unknown deployment kind');
      return { revision: snapshot.revision,
        groups: snapshot.groups.map(g => ({ id: g.id, targetAlias: g.target_alias, domains: g.domains.map(d => {
          if (!(GROUP_DOMAINS as readonly string[]).includes(d.domain)) throw new Error('Unknown group domain');
          return { domain: d.domain as GroupDomain, canisterId: d.canister.toText() };
        }) })),
        deployment: { id: first.deployment_id, alias: ctx.target.alias, networkKind: first.network_kind, host: first.host,
          revision: first.deployment_revision, enabled: true, additionalSubnetsEnabled: first.additional_subnets_enabled,
          primarySubnet: first.primary_subnet.toText(), approvedSubnets: first.approved_subnets.map(s => s.toText()) },
        bindings: snapshot.placements.map(p => ({ groupId: p.group_id, deploymentId: p.deployment_id, deploymentRevision: p.deployment_revision,
          domains: p.domains.map(d => {
            if (!(GROUP_DOMAINS as readonly string[]).includes(d.domain)) throw new Error('Unknown group placement domain');
            return { domain: d.domain as GroupDomain, canisterId: d.canister.toText(), subnetId: d.subnet.toText() };
          }) })),
      };
    },
    async readMemberships(context, offset, limit) {
      const { actor } = await connectLiveClubDomain(context.target, context.identity);
      const reply = await actor.read_my_club_memberships(offset, limit);
      if ('Err' in reply) throw new Error(reply.Err);
      return { clubs: reply.Ok.clubs, next: reply.Ok.next[0] ?? null, aclRevision: reply.Ok.acl_revision };
    },
    async readMembershipsIndexed(context, after, limit) {
      const { actor } = await connectLiveClubDomain(context.target, context.identity);
      const reply = await actor.read_my_club_memberships_indexed(after === null ? [] : [after], limit);
      if ('Err' in reply) throw new Error(reply.Err);
      return { clubs: reply.Ok.clubs, next: reply.Ok.next[0] ?? null, aclRevision: reply.Ok.acl_revision };
    },
    async readHostedAssignment(clubId, revision) {
      const reply = await router.read_hosted_club_assignment(clubId, ctx.target.alias, revision);
      if ('Err' in reply) throw new Error(reply.Err);
      return { clubId: reply.Ok.club_id, groupId: reply.Ok.group_id, revision: reply.Ok.revision };
    },
    async readAssignments(clubs, revision) {
      const reply = await router.read_my_group_assignments(clubs, ctx.target.alias, revision);
      if ('Err' in reply) throw new Error(reply.Err);
      return reply.Ok.map(a => ({ clubId: a.club_id, groupId: a.group_id, revision: a.revision }));
    },
  });
}
/** Which club owns an event, chat or team in this group's canister (null = not held here). */
export async function lookupEntityClub(ctx: FeatureBackendContext, kind: 'event' | 'conversation' | 'team' | 'clubLink' | 'roleRequest', id: string): Promise<string | null> {
  if (kind === 'roleRequest') return (await import('./roleRequestOwner')).lookupRoleRequestOwner(ctx, id);
  const d = await import('./domains');
  const unwrap = (r: { Ok: [] | [string] } | { Err: string }) => { if ('Err' in r) throw new Error(r.Err); return r.Ok[0] ?? null; };
  if (kind === 'event') return unwrap(await (await d.connectLiveEventsDomain(ctx.target, ctx.identity)).actor.read_event_club(id));
  if (kind === 'conversation') return unwrap(await (await d.connectLiveMessagingDomain(ctx.target, ctx.identity)).actor.read_conversation_club(id));
  if (kind === 'clubLink') {
    const result = await (await d.connectLiveClubDomain(ctx.target, ctx.identity)).actor.get_club_link(id);
    if ('Err' in result) throw new Error(result.Err);
    return result.Ok[0]?.club_id ?? null;
  }
  const { getLiveTeam } = await import('./features/club');
  return (await getLiveTeam(ctx, id))[0]?.club_id ?? null;
}

/** True when this group's club_domain recognises an invite token or id
 * (pending invite, team invite link, shell-team claim token or short code).
 * Location only: the token itself is the invitee's proof, as on the shared canisters. */
export async function groupHoldsInvite(ctx: FeatureBackendContext, token: string): Promise<boolean> {
  const c = await import('./features/club');
  const probes: Array<() => Promise<unknown>> = [
    () => c.getLivePendingInvite(ctx, token),
    () => c.getLiveTeamInviteLinkByToken(ctx, token),
    () => c.getLiveShellTeamByToken(ctx, token),
    () => c.resolveLiveInviteShortCode(ctx, token),
  ];
  for (const p of probes) {
    try { const r = await p(); if (r && !(Array.isArray(r) && r.length === 0)) return true; } catch { /* not this kind */ }
  }
  return false;
}
