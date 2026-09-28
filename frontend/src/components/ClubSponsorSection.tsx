import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { writeHomeSponsorHint } from "@/lib/homeSponsorHint";
import {
  CLUB_SPONSOR_CAROUSEL_PLACEMENT,
  SponsorCarouselPresentation,
  type SponsorCarouselItem,
} from "@/components/sponsor/SponsorCarouselPresentation";

interface ClubSponsorSectionProps {
  clubId: string | null;
}

export function ClubSponsorSection({ clubId }: ClubSponsorSectionProps) {
  const { user } = useAuth();

  // Fetch ALL active sponsors, showing team-allocated ones under team names
  const { data: sponsors = [] } = useQuery({
    queryKey: ["club-section-sponsors", clubId, user?.id],
    queryFn: async () => {
      if (!clubId) return [];

      // Pro-gate: free clubs can configure sponsors in the wizard/dashboard,
      // but they must NOT be displayed on the Home page until the club is on
      // an active Pro plan (or has an admin Pro override).
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .eq("club_id", clubId)
        .maybeSingle();
      const now = Date.now();
      const notExpired = !subs?.expires_at || new Date(subs.expires_at).getTime() > now;
      const hasPro = !!subs && notExpired && (
        subs.is_pro || subs.is_pro_football || subs.admin_pro_override || subs.admin_pro_football_override
      );
      if (!hasPro) return [];

      // Get club name
      const { data: club } = await supabase
        .from("clubs")
        .select("id, name")
        .eq("id", clubId)
        .single();

      if (!club) return [];

      // Fetch all active sponsors for this club
      const { data: allSponsors } = await supabase
        .from("sponsors")
        .select("id, name, is_active")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("name");

      if (!allSponsors || allSponsors.length === 0) return [];


      // Fetch team allocations with team names
      const { data: allocations } = await supabase
        .from("team_sponsor_allocations")
        .select("sponsor_id, team_id, teams!team_sponsor_allocations_team_id_fkey(id, name)")
        .in("sponsor_id", allSponsors.map(s => s.id));

      // Build a map of sponsor_id -> team names
      const sponsorTeamMap = new Map<string, string[]>();
      allocations?.forEach((alloc) => {
        if (alloc.teams?.name) {
          const existing = sponsorTeamMap.get(alloc.sponsor_id) || [];
          existing.push(alloc.teams.name);
          sponsorTeamMap.set(alloc.sponsor_id, existing);
        }
      });

      // Map sponsors: if allocated to teams, show under team name; otherwise show under club
      const result: SponsorCarouselItem[] = [];
      allSponsors.forEach((sponsor) => {
        const teamNames = sponsorTeamMap.get(sponsor.id);
        
        if (teamNames && teamNames.length > 0) {
          // Show once per team allocation
          teamNames.forEach((teamName) => {
            result.push({
              id: `club-${club.id}-${sponsor.id}-team-${teamName}`,
              sponsorId: sponsor.id,
              entityName: teamName,
            });
          });
        } else {
          // Club-level sponsor
          result.push({
            id: `club-${club.id}-${sponsor.id}`,
            sponsorId: sponsor.id,
            entityName: club.name,
          });
        }
      });

      return result;
    },
    enabled: !!clubId && !!user?.id,
  });

  // Persist a per-(user, club) hint so the home page can reserve the right
  // amount of vertical space on the next cold load and avoid a shift when
  // this section pops in after other content.
  useEffect(() => {
    if (!user?.id || !clubId) return;
    writeHomeSponsorHint(user.id, clubId, sponsors.length > 0 ? "has" : "none");
  }, [user?.id, clubId, sponsors.length]);


  if (!clubId) return null;

  return (
    <SponsorCarouselPresentation
      sponsors={sponsors}
      context="home_page"
      placement={CLUB_SPONSOR_CAROUSEL_PLACEMENT}
    />
  );
}
