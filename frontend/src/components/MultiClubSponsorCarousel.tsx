import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { writeHomeSponsorHint } from "@/lib/homeSponsorHint";
import {
  MULTI_CLUB_SPONSOR_CAROUSEL_PLACEMENT,
  SponsorCarouselPresentation,
  type SponsorCarouselItem,
} from "@/components/sponsor/SponsorCarouselPresentation";

export function MultiClubSponsorCarousel() {
  const { user } = useAuth();

  // Fetch ALL active sponsors, showing team-allocated ones under team names
  const { data: allSponsors = [] } = useQuery({
    queryKey: ["user-all-sponsors", user?.id],
    queryFn: async () => {
      // Get all club IDs the user is linked to
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select(`
          club_id,
          team_id,
          teams!user_roles_team_id_fkey(id, name, club_id)
        `)
        .eq("user_id", user!.id);

      if (rolesError) throw rolesError;

      // Collect unique club IDs
      const clubIds = new Set<string>();
      roles?.forEach((role) => {
        if (role.club_id) clubIds.add(role.club_id);
        if (role.teams?.club_id) clubIds.add(role.teams.club_id);
      });

      if (clubIds.size === 0) return [];

      // Only include sponsors from clubs on an active Pro plan.
      // Free-plan clubs can configure sponsors but they must not display.
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", Array.from(clubIds));

      const now = Date.now();
      const proClubIds = new Set<string>(
        (subs ?? [])
          .filter((s: any) => {
            const notExpired = !s.expires_at || new Date(s.expires_at).getTime() > now;
            return notExpired && (s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override);
          })
          .map((s: any) => s.club_id),
      );

      if (proClubIds.size === 0) return [];

      // Fetch all clubs for name lookup (Pro clubs only)
      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name")
        .in("id", Array.from(proClubIds));

      const clubNameMap = new Map<string, string>();
      clubs?.forEach((club) => clubNameMap.set(club.id, club.name));

      // Fetch ALL active sponsors for Pro clubs only
      const { data: sponsors } = await supabase
        .from("sponsors")
        .select("id, name, club_id, is_active")
        .in("club_id", Array.from(proClubIds))
        .eq("is_active", true)
        .order("name");

      if (!sponsors || sponsors.length === 0) return [];

      // Fetch team allocations with team names
      const { data: allocations } = await supabase
        .from("team_sponsor_allocations")
        .select("sponsor_id, team_id, teams!team_sponsor_allocations_team_id_fkey(id, name)")
        .in("sponsor_id", sponsors.map(s => s.id));

      // Build a map of sponsor_id -> team names (a sponsor can be allocated to multiple teams)
      const sponsorTeamMap = new Map<string, string[]>();
      allocations?.forEach((alloc) => {
        if (alloc.teams?.name) {
          const existing = sponsorTeamMap.get(alloc.sponsor_id) || [];
          existing.push(alloc.teams.name);
          sponsorTeamMap.set(alloc.sponsor_id, existing);
        }
      });

      // Map sponsors: if allocated to teams, show under each team; otherwise show under club
      const result: SponsorCarouselItem[] = [];
      sponsors.forEach((sponsor) => {
        const teamNames = sponsorTeamMap.get(sponsor.id);
        const clubName = clubNameMap.get(sponsor.club_id) || "";
        
        if (teamNames && teamNames.length > 0) {
          // Show once per team allocation
          teamNames.forEach((teamName) => {
            result.push({
              id: `sponsor-${sponsor.id}-team-${teamName}`,
              sponsorId: sponsor.id,
              entityName: teamName,
            });
          });
        } else {
          // Club-level sponsor
          result.push({
            id: `sponsor-${sponsor.id}`,
            sponsorId: sponsor.id,
            entityName: clubName,
          });
        }
      });

      return result;
    },
    enabled: !!user?.id,
  });

  // Persist a hint so the home page can reserve the right amount of vertical
  // space on the *next* cold load — prevents this tile from popping in later
  // and pushing surrounding sections down.
  useEffect(() => {
    if (!user?.id) return;
    writeHomeSponsorHint(user.id, null, allSponsors.length > 0 ? "has" : "none");
  }, [user?.id, allSponsors.length]);

  return (
    <SponsorCarouselPresentation
      sponsors={allSponsors}
      context="home_page"
      placement={MULTI_CLUB_SPONSOR_CAROUSEL_PLACEMENT}
    />
  );
}
