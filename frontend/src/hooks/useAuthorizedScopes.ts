/**
 * Authoritative membership snapshot for Realtime fail-closed filtering.
 *
 * Callers use this in Realtime callbacks to decide whether an incoming payload
 * belongs to a scope the current user is still allowed to see. The contract is
 * strictly fail-closed:
 *
 *   const { status, clubIds, teamIds, groupIds } = useAuthorizedScopes();
 *   channel.on('postgres_changes', {...}, (payload) => {
 *     if (status !== 'ready') return;              // drop while loading/failed
 *     if (!teamIds.has(payload.new.team_id)) return; // drop unknown scope
 *     // …safe to process
 *   });
 *
 * `ready` + empty set means "user has no memberships of that kind" — payloads
 * MUST be dropped. This is the inverse of the previous
 * `if (ids.size && !ids.has(x)) return;` guard which fails open on empty.
 *
 * Membership changes (role revoked, kicked, left) trigger a re-fetch and, via
 * `syncMembershipRevocations`, tear down any Realtime channels for scopes the
 * user has lost.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { revokeScope } from "@/lib/realtimeChannelRegistry";
import { membershipKeys } from "@/lab/membershipQueryKeys";

export type AuthorizedScopesStatus = "loading" | "ready" | "failed";

export interface AuthorizedScopes {
  status: AuthorizedScopesStatus;
  userId: string | null;
  clubIds: ReadonlySet<string>;
  teamIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
  /** Direct-message conversation ids the user is a participant in. */
  dmConversationIds: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

interface MembershipRow {
  clubIds: string[];
  teamIds: string[];
  groupIds: string[];
  dmConversationIds: string[];
}

async function fetchMemberships(userId: string): Promise<MembershipRow> {
  // `user_roles` is the single source of truth for club + team membership
  // (see mem://user-roles). `group_members` gates chat groups. DM access is
  // participant_1/participant_2 on `direct_conversations`.
  const [roles, groups, dms] = await Promise.all([
    supabase.from("user_roles").select("club_id, team_id").eq("user_id", userId),
    supabase.from("group_members").select("group_id").eq("user_id", userId),
    supabase
      .from("direct_conversations")
      .select("id, participant_1, participant_2")
      .or(`participant_1.eq.${userId},participant_2.eq.${userId}`),
  ]);

  // Fail-closed: any query error surfaces as failure. Callers treat `failed`
  // the same as `loading` and drop payloads.
  if (roles.error || groups.error || dms.error) {
    throw roles.error || groups.error || dms.error;
  }

  const clubIds = new Set<string>();
  const teamIds = new Set<string>();
  for (const r of (roles.data ?? []) as Array<{ club_id: string | null; team_id: string | null }>) {
    if (r.club_id) clubIds.add(r.club_id);
    if (r.team_id) teamIds.add(r.team_id);
  }

  return {
    clubIds: Array.from(clubIds),
    teamIds: Array.from(teamIds),
    groupIds: ((groups.data ?? []) as Array<{ group_id: string }>).map((r) => r.group_id),
    dmConversationIds: ((dms.data ?? []) as Array<{ id: string }>).map((r) => r.id),
  };
}

export function useAuthorizedScopes(): AuthorizedScopes {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: membershipKeys.authorizedScopesFor(userId),
    queryFn: () => fetchMemberships(userId as string),
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const prevRef = useRef<MembershipRow | null>(null);

  const snapshot = useMemo<AuthorizedScopes>(() => {
    if (!userId) {
      return { status: "loading", userId: null, clubIds: EMPTY, teamIds: EMPTY, groupIds: EMPTY, dmConversationIds: EMPTY };
    }
    if (query.isError) {
      return { status: "failed", userId, clubIds: EMPTY, teamIds: EMPTY, groupIds: EMPTY, dmConversationIds: EMPTY };
    }
    if (!query.data) {
      return { status: "loading", userId, clubIds: EMPTY, teamIds: EMPTY, groupIds: EMPTY, dmConversationIds: EMPTY };
    }
    return {
      status: "ready",
      userId,
      clubIds: new Set(query.data.clubIds),
      teamIds: new Set(query.data.teamIds),
      groupIds: new Set(query.data.groupIds),
      dmConversationIds: new Set(query.data.dmConversationIds),
    };
  }, [userId, query.isError, query.data]);

  // Detect scopes the user has *lost* since the previous snapshot and revoke
  // Realtime channels for them. Runs whenever fresh membership data arrives.
  useEffect(() => {
    if (!userId || !query.data) return;
    const prev = prevRef.current;
    prevRef.current = query.data;
    if (!prev) return;

    const diff = (before: string[], after: string[]) => {
      const afterSet = new Set(after);
      return before.filter((id) => !afterSet.has(id));
    };

    for (const id of diff(prev.clubIds, query.data.clubIds)) {
      revokeScope(userId, { kind: "club", id });
      // Club-admin conversation channels are scoped by club id.
      revokeScope(userId, { kind: "club_admin", id });
    }
    for (const id of diff(prev.teamIds, query.data.teamIds)) {
      revokeScope(userId, { kind: "team", id });
    }
    for (const id of diff(prev.groupIds, query.data.groupIds)) {
      revokeScope(userId, { kind: "group", id });
    }
    for (const id of diff(prev.dmConversationIds, query.data.dmConversationIds)) {
      revokeScope(userId, { kind: "dm", id });
    }
  }, [userId, query.data, queryClient]);

  return snapshot;
}

/**
 * Force a membership refresh. Call after any client-side action that mutates
 * membership (leave club, decline invite, admin removes user) so that
 * `useAuthorizedScopes` observes the change without waiting for staleTime.
 */
export function invalidateAuthorizedScopes(queryClient: ReturnType<typeof useQueryClient>, userId: string | null): void {
  if (!userId) return;
  queryClient.invalidateQueries({ queryKey: membershipKeys.authorizedScopesFor(userId) });
}
