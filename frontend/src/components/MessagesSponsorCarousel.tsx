import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  MESSAGES_SPONSOR_CAROUSEL_PLACEMENT,
  SponsorCarouselPresentation,
  type SponsorCarouselItem,
} from "@/components/sponsor/SponsorCarouselPresentation";

interface MessagesSponsorCarouselProps {
  activeClubFilter: string | null;
}

export function MessagesSponsorCarousel({ activeClubFilter }: MessagesSponsorCarouselProps) {
  const { user } = useAuth();

  // Fetch ALL active sponsors, showing team-allocated ones under team names
  const { data: sponsors = [] } = useQuery({
    queryKey: ["messages-all-sponsors", user?.id, activeClubFilter],
    queryFn: async () => {
      if (activeClubFilter) {
        // Filtered mode: show all active sponsors for this specific club
        const { data: club } = await supabase
          .from("clubs")
          .select("id, name")
          .eq("id", activeClubFilter)
          .maybeSingle();

        if (!club) return [];

        const { data: clubSponsors } = await supabase
          .from("sponsors")
          .select("id, name, is_active")
          .eq("club_id", activeClubFilter)
          .eq("is_active", true)
          .order("name");

        if (!clubSponsors || clubSponsors.length === 0) return [];

        // Fetch team allocations
        const { data: allocations } = await supabase
          .from("team_sponsor_allocations")
          .select("sponsor_id, team_id, teams!team_sponsor_allocations_team_id_fkey(id, name)")
          .in("sponsor_id", clubSponsors.map(s => s.id));

        const sponsorTeamMap = new Map<string, string[]>();
        allocations?.forEach((alloc) => {
          if (alloc.teams?.name) {
            const existing = sponsorTeamMap.get(alloc.sponsor_id) || [];
            existing.push(alloc.teams.name);
            sponsorTeamMap.set(alloc.sponsor_id, existing);
          }
        });

        const result: SponsorCarouselItem[] = [];
        clubSponsors.forEach((sponsor) => {
          const teamNames = sponsorTeamMap.get(sponsor.id);
          if (teamNames && teamNames.length > 0) {
            teamNames.forEach((teamName) => {
              result.push({
                id: `club-${club.id}-${sponsor.id}-team-${teamName}`,
                sponsorId: sponsor.id,
                entityName: teamName,
              });
            });
          } else {
            result.push({
              id: `club-${club.id}-${sponsor.id}`,
              sponsorId: sponsor.id,
              entityName: club.name,
            });
          }
        });

        return result;
      } else {
        // No filter: show all active sponsors from all user's clubs
        const { data: roles } = await supabase
          .from("user_roles")
          .select(`
            club_id,
            team_id,
            teams!user_roles_team_id_fkey(id, name, club_id)
          `)
          .eq("user_id", user!.id);

        if (!roles) return [];

        // Collect unique club IDs
        const clubIds = new Set<string>();
        roles.forEach((role) => {
          if (role.club_id) clubIds.add(role.club_id);
          if (role.teams?.club_id) clubIds.add(role.teams.club_id);
        });

        if (clubIds.size === 0) return [];

        // Fetch all clubs for name lookup
        const { data: clubs } = await supabase
          .from("clubs")
          .select("id, name")
          .in("id", Array.from(clubIds));

        const clubNameMap = new Map<string, string>();
        clubs?.forEach((club) => clubNameMap.set(club.id, club.name));

        // Fetch ALL active sponsors for these clubs
        const { data: allSponsors } = await supabase
          .from("sponsors")
          .select("id, name, club_id, is_active")
          .in("club_id", Array.from(clubIds))
          .eq("is_active", true)
          .order("name");

        if (!allSponsors || allSponsors.length === 0) return [];

        // Fetch team allocations
        const { data: allocations } = await supabase
          .from("team_sponsor_allocations")
          .select("sponsor_id, team_id, teams!team_sponsor_allocations_team_id_fkey(id, name)")
          .in("sponsor_id", allSponsors.map(s => s.id));

        const sponsorTeamMap = new Map<string, string[]>();
        allocations?.forEach((alloc) => {
          if (alloc.teams?.name) {
            const existing = sponsorTeamMap.get(alloc.sponsor_id) || [];
            existing.push(alloc.teams.name);
            sponsorTeamMap.set(alloc.sponsor_id, existing);
          }
        });

        const result: SponsorCarouselItem[] = [];
        allSponsors.forEach((sponsor) => {
          const teamNames = sponsorTeamMap.get(sponsor.id);
          const clubName = clubNameMap.get(sponsor.club_id) || "";
          
          if (teamNames && teamNames.length > 0) {
            teamNames.forEach((teamName) => {
              result.push({
                id: `sponsor-${sponsor.id}-team-${teamName}`,
                sponsorId: sponsor.id,
                entityName: teamName,
              });
            });
          } else {
            result.push({
              id: `sponsor-${sponsor.id}`,
              sponsorId: sponsor.id,
              entityName: clubName,
            });
          }
        });

        return result;
      }
    },
    enabled: !!user?.id,
    staleTime: 300000,
  });

  return (
    <SponsorCarouselPresentation
      sponsors={sponsors}
      context="messages_page"
      placement={MESSAGES_SPONSOR_CAROUSEL_PLACEMENT}
    />
  );
}
