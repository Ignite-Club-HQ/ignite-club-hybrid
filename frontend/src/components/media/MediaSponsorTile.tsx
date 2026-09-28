import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import {
  createTierWeightedPlaylist,
  type SponsorTier,
} from "@/components/sponsor/sponsorTier";

interface SponsorLite {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: SponsorTier;
}

/**
 * A photo-card-shaped sponsor tile injected into the Media feed.
 *
 * Renders when:
 *   1. A specific club is in scope (clubId prop or user's only club)
 *   2. clubs.media_sponsors_enabled === true for that club
 *   3. clubs.is_pro === true (sponsors are a Pro feature)
 *   4. At least one active sponsor exists for the club
 *
 * Selection is tier-weighted (platinum 6 > gold 4 > silver 2 > bronze 1).
 */
export function MediaSponsorTile({ seed, clubId }: { seed: number; clubId?: string | null }) {
  const { user } = useAuth();
  const { trackView, trackClick } = useSponsorAnalytics();

  // Resolve effective club: explicit prop wins; otherwise use the user's club
  // only if they belong to exactly one (avoids leaking sponsors across clubs).
  const { data: resolvedClubId } = useQuery({
    queryKey: ["media-sponsor-tile-club", clubId, user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (clubId) return clubId;
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);
      const ids = new Set<string>();
      (roles ?? []).forEach((r: any) => r.club_id && ids.add(r.club_id));
      const teamIds = (roles ?? []).map((r: any) => r.team_id).filter(Boolean);
      if (teamIds.length) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        (teams ?? []).forEach((t: any) => t.club_id && ids.add(t.club_id));
      }
      return ids.size === 1 ? Array.from(ids)[0] : null;
    },
  });

  // 1. Club-level opt-in toggle + Pro check
  const { data: clubFlag } = useQuery({
    queryKey: ["club-media-sponsors-enabled", resolvedClubId],
    enabled: !!resolvedClubId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, media_sponsors_enabled")
        .eq("id", resolvedClubId!)
        .maybeSingle();
      if (error) throw error;

      const { data: sub } = await supabase
        .from("club_subscriptions")
        .select("is_pro")
        .eq("club_id", resolvedClubId!)
        .maybeSingle();

      return { enabled: !!(data as any)?.media_sponsors_enabled, isPro: !!sub?.is_pro };
    },
  });

  const enabled = !!clubFlag?.enabled && !!clubFlag?.isPro;

  // 2. Sponsors fetched only when toggle is on.
  const { data: sponsors = [] } = useQuery({
    queryKey: ["club-media-sponsors", resolvedClubId],
    enabled: enabled && !!resolvedClubId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, website_url, tier")
        .eq("club_id", resolvedClubId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as SponsorLite[];
    },
  });

  // Weighted random pick, stable per seed.
  const sponsor = useMemo<SponsorLite | null>(() => {
    if (sponsors.length === 0) return null;
    const playlist = createTierWeightedPlaylist(sponsors);
    if (playlist.length === 0) return sponsors[0];
    return sponsors[playlist[seed % playlist.length]];
  }, [sponsors, seed]);

  const [viewed, setViewed] = useState<string | null>(null);
  useEffect(() => {
    if (!sponsor || !user?.id) return;
    if (viewed === sponsor.id) return;
    trackView(sponsor.id, "messages_page");
    setViewed(sponsor.id);
  }, [sponsor, user?.id, viewed, trackView]);

  if (!enabled || !sponsor) return null;

  const clickable = !!sponsor.website_url;
  const handleClick = () => {
    if (!clickable) return;
    trackClick(sponsor.id, "messages_page");
    safeOpenUrl(sponsor.website_url!);
  };

  return (
    <Card className="overflow-hidden cv-auto-card border-x-0 sm:border-x rounded-none sm:rounded-lg">
      <button
        type="button"
        onClick={handleClick}
        disabled={!clickable}
        className={`w-full text-left ${clickable ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Club Sponsor
          </span>
        </div>
        <div className="flex items-center gap-3 px-3 pb-3">
          <Avatar className="h-14 w-14 shrink-0 rounded-md">
            <AvatarImage src={sponsor.logo_url || undefined} className="object-contain" />
            <AvatarFallback className="rounded-md bg-secondary text-base">
              {sponsor.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{sponsor.name}</p>
            <p className="text-xs text-muted-foreground truncate">Proud club sponsor</p>
          </div>
          {clickable && <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />}
        </div>
      </button>
    </Card>
  );
}
