/** Lazy-load this explicit rehearsal API; nothing installs it in featureRouter.
 * Governor placement attestation is not independent subnet measurement.
 */
import { readPinnedGroupRegistry } from './groupRegistryPager';
import { generalRoutingDeploymentAlias } from './generalActivation';
import type { FeatureBackendContext } from './featureRouter';
import { openGroupSession, type GroupRegistry } from './groupSession';
import { GROUP_DOMAINS, type GroupDomain } from './groupRouting';
import type { EntityKind } from './groupDispatch';

export async function openLiveGroupReadSession(ctx: FeatureBackendContext, ownerGroupId?: 'g2') {
  const { connectLiveShardRouter, connectLiveClubDomain } = await import('./domains');
  const { actor: router } = await connectLiveShardRouter(ctx.target, ctx.identity);
  // The router filters by its on-chain deployment name; the frontend's own
  // target alias is a different, local name for the same deployment.
  const routerAlias = ownerGroupId ? ctx.target.alias : (generalRoutingDeploymentAlias() ?? ctx.target.alias);
  return openGroupSession(ctx, {
    async readRegistry(): Promise<GroupRegistry> {
      const principal = ctx.identity.getPrincipal().toText();
      const snapshot = await readPinnedGroupRegistry((revision, cursor, limit) => router.read_group_registry_page(routerAlias, revision, cursor, limit), undefined,
        () => { if (ctx.identity.getPrincipal().toText() !== principal) throw new Error('Registry identity changed'); });
      if (ownerGroupId) {
        const route = await (await import('./ownerTestRouting')).readOwnerTestRoute(ctx);
        if (!route || route.groupId !== ownerGroupId) throw new Error('Owner routing approval required');
        const receiptReply = await router.read_my_owner_test_opening(ctx.target.alias);
        if ('Err' in receiptReply) throw new Error(receiptReply.Err);
        const approval = receiptReply.Ok[0]?.approval;
        const actual = snapshot.groups.find(g => g.id === ownerGroupId), placed = snapshot.placements.find(p => p.group_id === ownerGroupId);
        const fingerprint = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);
        if (!approval || !actual || !placed || fingerprint(placed) !== fingerprint(approval.placement) ||
            fingerprint(actual.domains) !== fingerprint(approval.group.domains) || fingerprint(actual.photo_store) !== fingerprint(approval.group.photo_store) || actual.accepting) {
          throw new Error('Owner opening inventory no longer matches the exact approved placement');
        }
        snapshot.groups = snapshot.groups.filter(g => g.id === ownerGroupId);
        snapshot.placements = snapshot.placements.filter(p => p.group_id === ownerGroupId);
      }
      const first = snapshot.placements[0];
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
        }), photoStore: g.photo_store?.[0]?.toText() })),
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
      const reply = await router.read_hosted_club_assignment(clubId, routerAlias, revision);
      if ('Err' in reply) throw new Error(reply.Err);
      return { clubId: reply.Ok.club_id, groupId: reply.Ok.group_id, revision: reply.Ok.revision };
    },
    async readAssignments(clubs, revision) {
      const reply = await router.read_my_group_assignments(clubs, routerAlias, revision);
      if ('Err' in reply) throw new Error(reply.Err);
      return reply.Ok.map(a => ({ clubId: a.club_id, groupId: a.group_id, revision: a.revision }));
    },
    async readNewClubPlacement(clubId, revision) {
      const reply = await router.read_my_new_club_placement(clubId, routerAlias, revision);
      if ('Err' in reply) throw new Error(reply.Err);
      return { clubId: reply.Ok.club_id, groupId: reply.Ok.group_id, revision: reply.Ok.revision };
    },
  });
}
/** Which club owns an event, chat or team in this group's canister (null = not held here). */
export async function lookupEntityClub(ctx: FeatureBackendContext, kind: EntityKind, id: string): Promise<string | null> {
  if (kind === 'news') {
    const { listLiveMembershipClubs } = await import('./features/membership');
    const { listLiveNewsMulti } = await import('./features/club');
    const { listMyLiveMiniLeagues } = await import('./features/miniLeagues');
    const [clubs, leagues] = await Promise.all([listLiveMembershipClubs(ctx), listMyLiveMiniLeagues(ctx)]);
    const ids = [...new Set([...clubs.map(c => c.id), ...leagues.map(l => l.club_id)])];
    if (!ids.length) return null;
    return (await listLiveNewsMulti(ctx, ids)).find(p => p.id === id)?.club_id ?? null;
  }
  if (kind === 'photo' || kind === 'galleryCard') {
    const m = await import('./features/media');
    const row = kind === 'photo' ? await m.getLiveAsset(ctx, id) : await m.getLiveGalleryChatCard(ctx, id);
    return row?.club_id ?? null;
  }
  if (kind === 'miniLeague') return (await import('./miniLeagueOwner')).lookupMiniLeagueOwner(ctx, id);
  if (kind === 'roleRequest') return (await import('./roleRequestOwner')).lookupRoleRequestOwner(ctx, id);
  const d = await import('./domains');
  const unwrap = (r: { Ok: [] | [string] } | { Err: string }) => { if ('Err' in r) throw new Error(r.Err); return r.Ok[0] ?? null; };
  if (kind === 'competitionMatch' || kind === 'eoi') return unwrap(await (await d.connectLiveCompetitionDomain(ctx.target, ctx.identity)).actor.read_resource_club(kind === 'competitionMatch' ? 'match' : 'eoi', id));
  if (kind === 'vaultFile' || kind === 'vaultFolder') {
    const { actor } = await d.connectLiveVaultDomain(ctx.target, ctx.identity);
    return unwrap(await actor.read_resource_club(kind === 'vaultFile' ? 'file' : 'folder', id));
  }
  if (kind === 'notification') {
    const { actor } = await d.connectLiveNotificationQueue(ctx.target, ctx.identity);
    const row = await actor.get_notification(id);
    return row[0]?.club || null;
  }
  if (kind === 'scheduledMessage') {
    const { listLiveScheduledMessages } = await import('./features/notifications');
    const row = (await listLiveScheduledMessages(ctx, ctx.identity.getPrincipal().toText())).find(r => r.id === id);
    return row?.clubId || null;
  }
  if (kind === 'season') {
    const { actor } = await d.connectLiveClubDomain(ctx.target, ctx.identity);
    const row = await actor.read_season_club(id);
    return unwrap(row);
  }
  if (kind === 'competition') return unwrap(await (await d.connectLiveCompetitionDomain(ctx.target, ctx.identity)).actor.read_competition_club(id));
  if (kind === 'eventGroup') return unwrap(await (await d.connectLiveEventsDomain(ctx.target, ctx.identity)).actor.read_event_group_club(id));
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
  if (ctx.target.canisterIds.competition_domain) {
    const { connectLiveCompetitionDomain } = await import('./domains');
    const reply = await (await connectLiveCompetitionDomain(ctx.target, ctx.identity)).actor.read_token_club(token);
    if ('Err' in reply) throw new Error(reply.Err);
    if (reply.Ok.length) return true;
  }
  const c = await import('./features/club');
  const probes: Array<() => Promise<unknown>> = [
    () => c.getLivePendingInvite(ctx, token),
    () => c.getLiveParentInvite(ctx, token),
    () => c.getLiveTeamInviteLinkByToken(ctx, token),
    () => c.getLiveShellTeamByToken(ctx, token),
    () => c.resolveLiveInviteShortCode(ctx, token),
  ];
  for (const p of probes) {
    try { const r = await p(); if (r && !(Array.isArray(r) && r.length === 0)) return true; }
    catch (error) {
      // Only explicit domain absence is negative evidence. A timeout or
      // denied/expired token must never redirect acceptance to shared state.
      const message = error instanceof Error ? error.message : String(error);
      if (!/failed: (Invite not found|Invite link not found|Shell invite not found|Short code not found)$/.test(message)) throw error;
    }
  }
  const { connectLiveMiniLeagueDomain } = await import('./domains');
  if (!ctx.target.canisterIds.mini_league_domain) return false;
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  const preview = await actor.get_player_invite_preview(token);
  if ('Err' in preview) throw new Error(preview.Err);
  if (preview.Ok.length) return true;
  const reply = await actor.get_join_link_by_token(token);
  if ('Ok' in reply) return true;
  if (reply.Err === 'Join link not found') return false;
  throw new Error(reply.Err);
}
