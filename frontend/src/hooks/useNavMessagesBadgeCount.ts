import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { supabase } from "@/integrations/supabase/client";
import { useUnreadMessageCounts } from "@/hooks/useUnreadMessageCounts";
import { useSuppressedChatScopes } from "@/lib/pushTapSuppression";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

/**
 * Club-filtered Messages badge count shared by the mobile bottom nav and
 * desktop rail. Works in both backends: Supabase reads chat_groups /
 * notifications / direct_conversations / user_roles; ICP reads group
 * metadata and club role grants from the canisters (see inline comments).
 */
export function useNavMessagesBadgeCount(): number {
  const { unreadMessagesCount: globalMessagesCount, user } = useAuth();
  const { activeClubFilter, activeClubTeamIds } = useClubTheme();

  // Per-club message unread count: derive from the same breakdown the inbox/bell use
  // (fetchUnreadMessageCounts), then sum the slices that belong to the active club —
  // club chat + teams in the club + groups in the club — plus DMs and broadcasts
  // which are always visible in the inbox regardless of filter.
  //
  // Uses the shared useUnreadMessageCounts hook so the underlying RPC is
  // deduped with MessagesPage + MyTeamsPremiumCarousel (was previously firing
  // independently every 30s — top of the slow-query list).
  // Always fetch: the RPC is deduped across consumers, and we need the
  // per-scope breakdown even when no club filter is active so we can subtract
  // suppressed scopes (see useSuppressedChatScopes below) from the total.
  const { data: counts } = useUnreadMessageCounts(user?.id);

  // Broadcast club scoping (ICP): the canister has no per-club broadcast
  // notification row, but the global broadcast conversation lands in
  // `counts.groups` (fetchIcpUnreadMessageCounts maps any non-dm/team/club
  // kind to "groups"), and its clubId (always absent for the platform-wide
  // feed, present for any future per-club broadcast conversation) is read
  // via getLiveGroupMetadata into groupClubMap below — so club attribution
  // for broadcasts falls out of the existing group->club mapping with no
  // extra query needed.
  // DM club scoping (ICP): resolved by calling the club_domain membership
  // wrapper (listLiveRoleGrants) for the active club and checking whether
  // the DM peer's principal holds a role there. That call is club-admin
  // gated canister-side, so non-admin members fall back to counting their
  // unread DMs under every club filter they view (documented below) rather
  // than silently dropping the badge.
  const messagingOnIcp = isFeatureRoutedToIcp("messaging");

  // Secondary lookup: which chat groups belong to the active club. Cached
  // separately so it doesn't piggy-back on every unread refetch.
  const groupIds = counts ? Object.keys(counts.groups) : [];
  const { data: groupClubMap = {} as Record<string, { club_id: string | null; team_id: string | null }> } = useQuery({
    queryKey: ["chat-groups-club-map", groupIds.sort().join(","), messagingOnIcp],
    queryFn: async () => {
      if (groupIds.length === 0) return {};
      if (messagingOnIcp) {
        const [{ icpCtx }, messaging] = await Promise.all([
          import("@/lib/icpClubTeamLookup"),
          import("@/live/features/messaging"),
        ]);
        const ctx = await icpCtx();
        const map: Record<string, { club_id: string | null; team_id: string | null }> = {};
        await Promise.all(groupIds.map(async (id) => {
          try {
            const meta = await messaging.getLiveGroupMetadata(ctx, id);
            map[id] = { club_id: meta.clubId, team_id: meta.teamId };
          } catch {
            // Best-effort: a group whose metadata can't be read is omitted
            // from the club map, so its unread count is simply not folded
            // into any club's badge (never throws, never blocks the nav).
          }
        }));
        return map;
      }
      const { data } = await supabase
        .from("chat_groups")
        .select("id, club_id, team_id")
        .in("id", groupIds);
      const map: Record<string, { club_id: string | null; team_id: string | null }> = {};
      data?.forEach((g) => { map[g.id] = { club_id: g.club_id, team_id: g.team_id }; });
      return map;
    },
    enabled: groupIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Suppressed scopes are the chats the user just tapped a push for. We
  // subtract their unread contribution from the badge for ~1.5s so it
  // doesn't flash a number that is about to clear as soon as the chat page
  // mounts and marks the message read.
  const suppressedScopes = useSuppressedChatScopes();
  const suppressionDelta = (() => {
    if (!counts || suppressedScopes.length === 0) return 0;
    let delta = 0;
    for (const s of suppressedScopes) {
      if (!s.targetId && s.kind === "broadcast") { delta += counts.broadcast; continue; }
      if (!s.targetId) continue;
      switch (s.kind) {
        case "team": delta += counts.teams[s.targetId] || 0; break;
        case "club": delta += counts.clubs[s.targetId] || 0; break;
        case "group": delta += counts.groups[s.targetId] || 0; break;
        case "dm": delta += counts.dms[s.targetId] || 0; break;
        // club_admin isn't broken out in counts; skip.
      }
    }
    return delta;
  })();

  // Broadcast notifications are not club-owned on `broadcast_messages`, but the
  // notification row carries `club_id`. When a club filter is active we must
  // only count broadcasts belonging to that club — otherwise another club's
  // announcement inflates a badge with no matching row in the filtered inbox.
  const { data: clubBroadcastUnread = 0 } = useQuery({
    queryKey: ["bottomnav-club-broadcast-unread", user?.id, activeClubFilter, messagingOnIcp],
    enabled: !!user?.id && !!activeClubFilter && !messagingOnIcp,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("type", "broadcast")
        .eq("is_read", false)
        .eq("club_id", activeClubFilter!);
      if (error) throw error;
      return count ?? 0;
    },
  });
  // ICP: broadcast conversations carry their clubId through groupClubMap
  // (see comment above), so a club-scoped broadcast group is already folded
  // into clubMessagesCount's `groups` sum below — no separate query needed,
  // and this Supabase-only count stays 0 (counts.broadcast is also always 0
  // on ICP, so the Math.min guard below is a no-op there).

  // DM unreads are only counted under a club filter when the other participant
  // holds a role in that club — otherwise the badge shows a number with no
  // matching thread in the filtered inbox.
  const unreadDmConversationIds = counts
    ? Object.entries(counts.dms).filter(([, n]) => (n || 0) > 0).map(([id]) => id)
    : [];
  const { data: clubScopedDmIds } = useQuery({
    queryKey: ["bottomnav-club-scoped-dms", user?.id, activeClubFilter, unreadDmConversationIds.sort().join(","), messagingOnIcp],
    enabled: !!user?.id && !!activeClubFilter && unreadDmConversationIds.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (messagingOnIcp) {
        const [{ icpCtx }, messaging, membership] = await Promise.all([
          import("@/lib/icpClubTeamLookup"),
          import("@/live/features/messaging"),
          import("@/live/features/membership"),
        ]);
        const ctx = await icpCtx();
        const myPrincipal = ctx.identity.getPrincipal().toText();
        const peerByConv = new Map<string, string>();
        await Promise.all(unreadDmConversationIds.map(async (id) => {
          try {
            const meta = await messaging.getLiveGroupMetadata(ctx, id);
            const other = meta.members.map((p) => p.toText()).find((p) => p !== myPrincipal);
            if (other) peerByConv.set(id, other);
          } catch {
            // Best-effort: a DM whose metadata can't be read is left out of
            // the club-scoped set (never throws, never blocks the badge).
          }
        }));
        try {
          // club_domain `list_role_grants` is club-admin gated, so this
          // throws for a regular member viewing their own club filter.
          const grants = (await membership.listLiveRoleGrants(ctx, activeClubFilter!)) as Array<{ account_id: string }>;
          const inClub = new Set(grants.map((g) => g.account_id));
          return Array.from(peerByConv.entries())
            .filter(([, principal]) => inClub.has(principal))
            .map(([cid]) => cid);
        } catch {
          // Documented fallback: without admin access to the club's role
          // grants there is no cheap way to resolve a DM peer's clubs on
          // ICP, so every unread DM is counted under every club filter the
          // member views rather than dropped from the badge entirely.
          return Array.from(peerByConv.keys());
        }
      }
      const { data: convs } = await supabase
        .from("direct_conversations")
        .select("id, participant_1, participant_2")
        .in("id", unreadDmConversationIds);
      const peerByConv = new Map<string, string>();
      (convs || []).forEach((c: any) => {
        const other = c.participant_1 === user!.id ? c.participant_2 : c.participant_1;
        if (other) peerByConv.set(c.id, other);
      });
      const peerIds = Array.from(new Set(peerByConv.values()));
      if (peerIds.length === 0) return [] as string[];
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", activeClubFilter!)
        .in("user_id", peerIds);
      const inClub = new Set((roles || []).map((r: any) => r.user_id));
      return Array.from(peerByConv.entries())
        .filter(([, uid]) => inClub.has(uid))
        .map(([cid]) => cid);
    },
  });

  const clubDmUnreadCount = (() => {
    if (!counts || !clubScopedDmIds) return 0;
    const suppressedDms = new Set(
      suppressedScopes.filter(s => s.kind === "dm" && s.targetId).map(s => s.targetId!)
    );
    return clubScopedDmIds.reduce(
      (a, id) => a + (suppressedDms.has(id) ? 0 : (counts.dms[id] || 0)),
      0
    );
  })();


  const clubMessagesCount = (() => {
    if (!counts || !activeClubFilter) return 0;
    const clubGroupIds = new Set<string>();
    for (const gid of groupIds) {
      const meta = groupClubMap[gid];
      if (!meta) continue;
      if (meta.club_id === activeClubFilter) clubGroupIds.add(gid);
      else if (meta.team_id && activeClubTeamIds.includes(meta.team_id)) clubGroupIds.add(gid);
    }
    const suppressedTeams = new Set(suppressedScopes.filter(s => s.kind === "team" && s.targetId).map(s => s.targetId!));
    const suppressedClubs = new Set(suppressedScopes.filter(s => s.kind === "club" && s.targetId).map(s => s.targetId!));
    const suppressedGroups = new Set(suppressedScopes.filter(s => s.kind === "group" && s.targetId).map(s => s.targetId!));
    const suppressBroadcast = suppressedScopes.some(s => s.kind === "broadcast");

    const sumRecord = (rec: Record<string, number>, keys: string[], skip: Set<string>) =>
      keys.reduce((acc, k) => acc + (skip.has(k) ? 0 : (rec[k] || 0)), 0);
    return (
      (suppressBroadcast ? 0 : Math.min(clubBroadcastUnread, counts.broadcast)) +
      (suppressedClubs.has(activeClubFilter) ? 0 : (counts.clubs[activeClubFilter] || 0)) +
      sumRecord(counts.teams, activeClubTeamIds, suppressedTeams) +
      sumRecord(counts.groups, Array.from(clubGroupIds), suppressedGroups)
    );
  })();

  const unreadMessagesCount = activeClubFilter
    ? clubMessagesCount + clubDmUnreadCount
    : Math.max(0, globalMessagesCount - suppressionDelta);

  return unreadMessagesCount;
}
