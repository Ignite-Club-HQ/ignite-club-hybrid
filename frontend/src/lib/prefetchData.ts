import { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { refreshSessionOnce } from "@/lib/refreshSessionOnce";
import { selectCachedProfileById } from "@/lib/profileCache";
import { cacheRoles } from "@/lib/rolesCache";
import { cacheClubs, cacheTeams, getCachedClubs, getCachedTeams } from "@/lib/clubTeamCache";

const MESSAGES_PER_PAGE = 15;

export async function prefetchUserData(queryClient: QueryClient, userId: string) {
  // Run prefetch in background - never block UI
  doPrefetch(queryClient, userId).catch(console.error);
}

async function doPrefetch(queryClient: QueryClient, userId: string) {
  try {
    // Try the consolidated Edge Function first (single round-trip)
    const edgeResult = await tryEdgePrefetch(queryClient, userId);
    if (edgeResult) {
      // Edge function succeeded — now fire background message prefetch
      fireMessagePrefetch(
        queryClient,
        userId,
        edgeResult.teamIds,
        edgeResult.clubIds,
        edgeResult.chatGroups,
        edgeResult.dmConversations
      );
      return;
    }

    // Fallback: direct Supabase queries (original approach)
    console.warn("[Prefetch] Edge function unavailable, falling back to direct queries");
    await doPrefetchDirect(queryClient, userId);
  } catch (error) {
    console.error("Prefetch error:", error);
  }
}

/** Call the consolidated Edge Function and populate all caches */
async function tryEdgePrefetch(
  queryClient: QueryClient,
  userId: string
): Promise<{
  teamIds: string[];
  clubIds: string[];
  chatGroups: any[];
  dmConversations: any[];
} | null> {
  try {
    // Only call edge function if we have a valid user session (not just anon key)
    let { data: sessionData } = await supabase.auth.getSession();
    let session = sessionData?.session;

    // If session expires within 60s, refresh proactively to avoid a 401
    // race between getSession() and the edge invoke.
    const nowSec = Math.floor(Date.now() / 1000);
    if (session && (session.expires_at ?? 0) - nowSec <= 60) {
      const { session: refreshedSession } = await refreshSessionOnce(10000);
      if (refreshedSession) session = refreshedSession;
    }

    const accessToken = session?.access_token;
    if (!accessToken) {
      // No session yet — silently skip. Falling back to direct queries would
      // also fail RLS, so just return null and let the caller decide.
      return null;
    }

    // Pass the token explicitly so we never accidentally invoke with just
    // the anon key (which would return 401 "Auth session missing").
    const { data, error } = await supabase.functions.invoke("prefetch-user-data", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (error || !data) {
      // 401s here are non-fatal — the session likely just expired between
      // getSession() and invoke(). Skip silently to avoid log noise.
      return null;
    }

    const {
      roles,
      clubs,
      teams,
      chatGroups,
      dmConversations,
      broadcastMessages,
      profile,
      isAppAdmin,
      hasProClub,
    } = data;

    // Cache roles
    cacheRoles(roles);
    queryClient.setQueryData(["userRoles", userId], roles);

    // Cache clubs and teams
    if (clubs?.length) cacheClubs(clubs);
    if (teams?.length) cacheTeams(teams);

    // Cache broadcast messages
    if (broadcastMessages?.length) {
      const messagesToCache = broadcastMessages.slice(0, MESSAGES_PER_PAGE);
      queryClient.setQueryData(["broadcast-messages"], {
        messages: messagesToCache.map((msg: any) => ({
          ...msg,
          reactions: [],
          reply_to: null,
        })),
        hasOlderMessages: broadcastMessages.length > MESSAGES_PER_PAGE,
      });
    }

    // Cache media access data
    queryClient.setQueryData(["media-access-data", userId], {
      profile,
      roles,
      isAppAdmin,
      hasProClub,
    });

    const clubIds = [...new Set(roles.map((r: any) => r.club_id).filter(Boolean))] as string[];
    const teamIds = [...new Set(roles.map((r: any) => r.team_id).filter(Boolean))] as string[];

    return { teamIds, clubIds, chatGroups, dmConversations };
  } catch {
    return null;
  }
}

/** Fire-and-forget message prefetch for teams, clubs, groups, DMs */
function fireMessagePrefetch(
  queryClient: QueryClient,
  userId: string,
  teamIds: string[],
  clubIds: string[],
  chatGroups: any[],
  dmConversations: any[]
) {
  const MAX_PREFETCH_TEAMS = 5;
  const MAX_PREFETCH_CLUBS = 3;
  const MAX_PREFETCH_GROUPS = 5;

  const messagePromises: Promise<void>[] = [];

  // Team messages
  teamIds.slice(0, MAX_PREFETCH_TEAMS).forEach((teamId) => {
    messagePromises.push(
      (async () => {
        const { data } = await supabase
          .from("team_messages")
          .select("id, text, image_url, created_at, author_id, team_id, reply_to_id")
          .eq("team_id", teamId)
          .order("created_at", { ascending: false })
          .limit(MESSAGES_PER_PAGE + 1);
        if (data) {
          queryClient.setQueryData(["team-messages", teamId], {
            messages: data.slice(0, MESSAGES_PER_PAGE).map((msg: any) => ({
              ...msg, profiles: null, reactions: [], reply_to: null,
            })),
            hasOlderMessages: data.length > MESSAGES_PER_PAGE,
          });
        }
      })()
    );
  });

  // Club messages
  clubIds.slice(0, MAX_PREFETCH_CLUBS).forEach((clubId) => {
    messagePromises.push(
      (async () => {
        const { data } = await supabase
          .from("club_messages")
          .select("id, text, image_url, created_at, author_id, club_id, reply_to_id")
          .eq("club_id", clubId)
          .order("created_at", { ascending: false })
          .limit(MESSAGES_PER_PAGE + 1);
        if (data) {
          queryClient.setQueryData(["club-messages", clubId], {
            messages: data.slice(0, MESSAGES_PER_PAGE).map((msg: any) => ({
              ...msg, profiles: null, reactions: [], reply_to: null,
            })),
            hasOlderMessages: data.length > MESSAGES_PER_PAGE,
          });
        }
      })()
    );
  });

  // Group messages
  chatGroups.slice(0, MAX_PREFETCH_GROUPS).forEach((group: any) => {
    messagePromises.push(
      (async () => {
        const { data } = await supabase
          .from("group_messages")
          .select("id, text, image_url, created_at, author_id, group_id, reply_to_id")
          .eq("group_id", group.id)
          .order("created_at", { ascending: false })
          .limit(MESSAGES_PER_PAGE + 1);
        if (data) {
          queryClient.setQueryData(["group-messages", group.id], {
            messages: data.slice(0, MESSAGES_PER_PAGE).map((msg: any) => ({
              ...msg, author: null, reactions: [], reply_to: null,
            })),
            hasOlderMessages: data.length > MESSAGES_PER_PAGE,
          });
        }
      })()
    );
  });

  // DM messages
  if (dmConversations?.length) {
    messagePromises.push(
      (async () => {
        try {
          await Promise.all(
            dmConversations.map(async (conv: any) => {
              const { data } = await supabase
                .from("direct_messages")
                .select("id, text, image_url, created_at, author_id, conversation_id, reply_to_id")
                .eq("conversation_id", conv.id)
                .order("created_at", { ascending: false })
                .limit(MESSAGES_PER_PAGE + 1);
              if (data) {
                queryClient.setQueryData(["dm-messages", conv.id], {
                  messages: data.slice(0, MESSAGES_PER_PAGE).map((msg: any) => ({
                    ...msg, author: null, reactions: [], reply_to: null,
                  })),
                  hasOlderMessages: data.length > MESSAGES_PER_PAGE,
                  reactions: [],
                });
              }
            })
          );
        } catch {
          // Silent fail
        }
      })()
    );
  }

  Promise.allSettled(messagePromises).catch(console.error);
}

/** Original direct-query fallback (unchanged logic) */
async function doPrefetchDirect(queryClient: QueryClient, userId: string) {
  try {
    const [rolesResult, broadcastResult] = await Promise.all([
      supabase
        .from("user_roles")
        .select("id, role, club_id, team_id")
        .eq("user_id", userId),
      supabase
        .from("broadcast_messages")
        .select("id, text, image_url, created_at, author_id, reply_to_id")
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1),
    ]);

    const roles = rolesResult.data || [];
    cacheRoles(roles);
    queryClient.setQueryData(["userRoles", userId], roles);

    const clubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))] as string[];
    const teamIds = [...new Set(roles.map(r => r.team_id).filter(Boolean))] as string[];

    await prefetchClubTeamMetadata(clubIds, teamIds);

    const isAppAdmin = roles.some(r => r.role === "app_admin");
    prefetchMediaAccess(queryClient, userId, roles, isAppAdmin, clubIds, teamIds);

    let accessibleGroups: Array<{ id: string; name: string; club_id: string | null; team_id: string | null; allowed_roles: string[] }> = [];

    if (clubIds.length > 0 || teamIds.length > 0) {
      // Split the OR into two `.in()` queries executed in parallel. The
      // combined `.or(club_id.in.(...),team_id.in.(...))` form forces a
      // bitmap-or plan that is 5-10x slower than two indexed scans against
      // idx_chat_groups_club_id / idx_chat_groups_team_id.
      const [clubGroupsRes, teamGroupsRes] = await Promise.all([
        clubIds.length > 0
          ? supabase
              .from("chat_groups")
              .select("id, name, club_id, team_id, allowed_roles")
              .in("club_id", clubIds)
          : Promise.resolve({ data: [] as any[] }),
        teamIds.length > 0
          ? supabase
              .from("chat_groups")
              .select("id, name, club_id, team_id, allowed_roles")
              .in("team_id", teamIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const seen = new Set<string>();
      const chatGroups: any[] = [];
      for (const g of [...(clubGroupsRes.data || []), ...(teamGroupsRes.data || [])]) {
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        chatGroups.push(g);
      }

      accessibleGroups = chatGroups.filter(group => {
        const userRolesForGroup = roles.filter(r =>
          (group.club_id && r.club_id === group.club_id) ||
          (group.team_id && r.team_id === group.team_id)
        );
        return userRolesForGroup.some(r => (group.allowed_roles as string[]).includes(r.role));
      });
    }

    const { data: personalGroups } = await supabase
      .from("group_members")
      .select("group_id, chat_groups:group_id(id, name, club_id, team_id, allowed_roles)")
      .eq("user_id", userId)
      .limit(10);

    if (personalGroups) {
      for (const pg of personalGroups) {
        const group = (pg as any).chat_groups;
        if (group && !group.club_id && !group.team_id) {
          accessibleGroups.push(group);
        }
      }
    }

    if (broadcastResult.data) {
      const messagesToCache = broadcastResult.data.slice(0, MESSAGES_PER_PAGE);
      queryClient.setQueryData(["broadcast-messages"], {
        messages: messagesToCache.map((msg: any) => ({
          ...msg,
          reactions: [],
          reply_to: null,
        })),
        hasOlderMessages: (broadcastResult.data?.length || 0) > MESSAGES_PER_PAGE,
      });
    }

    // Fire message prefetch
    const dmResult = await supabase
      .from("direct_conversations")
      .select("id")
      .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
      .limit(5);

    fireMessagePrefetch(queryClient, userId, teamIds, clubIds, accessibleGroups, dmResult.data || []);
  } catch (error) {
    console.error("Direct prefetch error:", error);
  }
}

async function prefetchMediaAccess(
  queryClient: QueryClient,
  userId: string,
  roles: Array<{ id: string; role: string; club_id: string | null; team_id: string | null }>,
  isAppAdmin: boolean,
  clubIds: string[],
  teamIds: string[]
) {
  try {
    const profilePromise = selectCachedProfileById(userId);


    if (isAppAdmin) {
      const profileResult = await profilePromise;
      queryClient.setQueryData(["media-access-data", userId], {
        profile: profileResult.data,
        roles,
        isAppAdmin: true,
        hasProClub: true,
      });
      return;
    }

    const [profileResult, teamsResult, clubSubsResult] = await Promise.all([
      profilePromise,
      teamIds.length > 0
        ? supabase.from("teams").select("id, club_id").in("id", teamIds)
        : Promise.resolve({ data: null }),
      clubIds.length > 0
        ? supabase.from("club_subscriptions").select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override").in("club_id", clubIds)
        : Promise.resolve({ data: null }),
    ]);

    let hasProClub = false;

    if (clubSubsResult.data && clubSubsResult.data.some(s =>
      s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
    )) {
      hasProClub = true;
    }

    if (!hasProClub && teamsResult.data) {
      const teamClubIds = [...new Set(teamsResult.data.map(t => t.club_id).filter(Boolean))] as string[];
      if (teamClubIds.length > 0) {
        const { data: teamClubSubs } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("club_id", teamClubIds);
        if (teamClubSubs?.some(s =>
          s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
        )) {
          hasProClub = true;
        }
      }
    }

    if (!hasProClub && teamIds.length > 0) {
      const { data: teamSubsResult } = await supabase
        .from("team_subscriptions")
        .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("team_id", teamIds);
      hasProClub = teamSubsResult?.some(s =>
        s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
      ) || false;
    }

    queryClient.setQueryData(["media-access-data", userId], {
      profile: profileResult.data,
      roles,
      isAppAdmin: false,
      hasProClub,
    });
  } catch (error) {
    console.error("Media access prefetch error:", error);
  }
}

async function prefetchClubTeamMetadata(clubIds: string[], teamIds: string[]) {
  try {
    const { missing: missingClubIds } = getCachedClubs(clubIds);
    const { missing: missingTeamIds } = getCachedTeams(teamIds);

    const clubsPromise = missingClubIds.length > 0
      ? (async () => {
          const { data } = await supabase
            .from("clubs")
            .select("id, name, logo_url, sport, is_pro")
            .in("id", missingClubIds);
          if (data) cacheClubs(data);
        })()
      : Promise.resolve();

    const teamsPromise = missingTeamIds.length > 0
      ? (async () => {
          const { data } = await supabase
            .from("teams")
            .select("id, name, logo_url, club_id, level_age")
            .in("id", missingTeamIds);
          if (data) cacheTeams(data);
        })()
      : Promise.resolve();

    await Promise.all([clubsPromise, teamsPromise]);
  } catch (error) {
    console.error("Club/team metadata prefetch error:", error);
  }
}
