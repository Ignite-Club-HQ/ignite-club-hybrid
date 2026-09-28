import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClubTheme } from "@/hooks/useClubTheme";
import {
  getAppliedNotificationClubSwitch,
  isNotificationClubSwitchInFlight,
} from "@/lib/notificationClubSwitch";
import { resolveRouteClubScope } from "@/lib/routeClubScope";
import { lookupRouteClubId } from "@/lib/clubScopeLookup";

import { useAuth } from "@/hooks/useAuth";
import { isIgniteSupportUser } from "@/lib/systemUser";

/**
 * Club scope guard.
 *
 * Mounted once in `AppLayout`. When the active club filter points at club B but
 * the currently open route renders content owned by club A, the user is sent
 * back to the home page. Without this, switching the club theme leaves the
 * previous club's team/chat/event/vault content on screen.
 *
 * Deliberately conservative:
 *  - Only acts when a specific club is selected (`activeClubFilter` non-null).
 *  - Only acts when the route's owning club resolves to a real, different id —
 *    NULL / unknown / still-loading never redirects.
 *  - Honours the notification club-switch pin so a push-driven navigation into
 *    another club's thread isn't bounced before the filter reconciles.
 */
export function useClubScopeGuard() {
  const { activeClubFilter } = useClubTheme();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const scope = resolveRouteClubScope(location.pathname);

  const needsLookup = scope.kind === "lookup";
  const lookupTable = scope.kind === "lookup" ? scope.table : null;
  const lookupId = scope.kind === "lookup" ? scope.id : null;

  const { data: lookedUpClubId, isFetched } = useQuery({
    queryKey: ["route-club-scope", lookupTable, lookupId],
    queryFn: async () => {
      if (!lookupTable || !lookupId) return null;
      // Fail open inside `lookupRouteClubId`: an RLS/network error resolves to
      // null and never bounces the user. Team-owned rows (NULL club_id) are
      // resolved through their team so they are not treated as unscoped.
      return await lookupRouteClubId(lookupTable, lookupId);
    },


    enabled: needsLookup && !!activeClubFilter,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  // Competitions: resolve every club legitimately participating (organiser +
  // clubs with an entered team). The route is scoped OUT only when the newly
  // selected club is in none of them.
  const competitionId = scope.kind === "membership" ? scope.competitionId : null;
  const { data: competitionClubIds, isFetched: competitionFetched } = useQuery({
    queryKey: ["route-competition-clubs", competitionId],
    queryFn: async () => {
      if (!competitionId) return null;
      const [comp, entries] = await Promise.all([
        supabase.from("competitions").select("organizer_club_id").eq("id", competitionId).maybeSingle(),
        supabase
          .from("competition_entries")
          .select("teams!inner(club_id)")
          .eq("competition_id", competitionId),
      ]);
      // Fail open on any error: never bounce on a network/RLS hiccup.
      if (comp.error || entries.error) return null;
      const ids = new Set<string>();
      if (comp.data?.organizer_club_id) ids.add(comp.data.organizer_club_id as string);
      for (const row of entries.data ?? []) {
        const clubId = (row as { teams?: { club_id?: string | null } | null }).teams?.club_id;
        if (clubId) ids.add(clubId);
      }
      return ids.size > 0 ? Array.from(ids) : null;
    },
    enabled: !!competitionId && !!activeClubFilter,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  // Direct messages: resolve the other participant, then ask the DB whether
  // they belong to the newly selected club. Fails open on any error, and never
  // bounces the Ignite Support conversation (a system user with no club).
  const dmConversationId = scope.kind === "dm" ? scope.conversationId : null;
  const { data: dmAllowed, isFetched: dmFetched } = useQuery({
    queryKey: ["route-dm-club-scope", dmConversationId, activeClubFilter, user?.id],
    queryFn: async () => {
      if (!dmConversationId || !activeClubFilter || !user?.id) return true;
      const { data, error } = await supabase
        .from("direct_conversations")
        .select("participant_1, participant_2")
        .eq("id", dmConversationId)
        .maybeSingle();
      if (error || !data) return true;
      const otherId =
        data.participant_1 === user.id ? data.participant_2 : data.participant_1;
      if (!otherId || otherId === user.id || isIgniteSupportUser(otherId)) return true;
      const { data: isMember, error: memberError } = await supabase.rpc("is_club_member", {
        _user_id: otherId,
        _club_id: activeClubFilter,
      });
      if (memberError) return true;
      return !!isMember;
    },
    enabled: !!dmConversationId && !!activeClubFilter && !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  const dmMismatch = scope.kind === "dm" && dmFetched && dmAllowed === false;

  const owningClubId =
    scope.kind === "direct"
      ? scope.clubId
      : needsLookup && isFetched
        ? (lookedUpClubId ?? null)
        : null;

  // Guard against redirect loops if "/" itself somehow resolved to a scope.
  const lastRedirectedFrom = useRef<string | null>(null);
  // Re-evaluates the guard after an in-flight notification switch resolves.
  const [recheckTick, setRecheckTick] = useState(0);

  // For competition routes the "owning club" is the participation set: report a
  // mismatch (using the organiser id purely as a marker) when the active club is
  // absent from it.
  const competitionMismatch =
    scope.kind === "membership" &&
    competitionFetched &&
    !!competitionClubIds &&
    !!activeClubFilter &&
    !competitionClubIds.includes(activeClubFilter);

  useEffect(() => {
    if (!activeClubFilter) return;
    if (competitionMismatch || dmMismatch) {
      if (location.pathname === "/") return;
      if (lastRedirectedFrom.current === location.pathname + "|" + activeClubFilter) return;
      lastRedirectedFrom.current = location.pathname + "|" + activeClubFilter;
      navigate("/", { replace: true });
      return;
    }
    if (!owningClubId) return;
    if (owningClubId === activeClubFilter) return;
    // A push-notification driven switch is mid-reconciliation: let it settle.
    // `applied` lands only after membership verification (several round trips),
    // so also honour the short-lived in-flight marker written the moment the
    // switch is requested — otherwise the guard wins the race and bounces home.
    if (getAppliedNotificationClubSwitch() === owningClubId) return;
    if (isNotificationClubSwitchInFlight(owningClubId)) {
      // Re-check shortly: if membership verification rejects the switch the
      // marker disappears and the route must still be scoped out.
      const t = setTimeout(() => setRecheckTick((n) => n + 1), 1000);
      return () => clearTimeout(t);
    }



    if (location.pathname === "/") return;
    if (lastRedirectedFrom.current === location.pathname + "|" + activeClubFilter) return;
    lastRedirectedFrom.current = location.pathname + "|" + activeClubFilter;
    navigate("/", { replace: true });
  }, [activeClubFilter, owningClubId, competitionMismatch, dmMismatch, location.pathname, navigate, recheckTick]);
}
