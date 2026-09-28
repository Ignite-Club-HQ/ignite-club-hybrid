import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { SponsorTier, TIER_CONFIG } from "@/lib/sponsorTiers";

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  description: string | null;
  tier: SponsorTier | null;
}

export type PrimarySponsorContext =
  | "club_page"
  | "team_page"
  | "club_card"
  | "event_page"
  | "event_card"
  | "home_page"
  | "messages_page";

interface PrimarySponsorDisplayProps {
  sponsorId: string | null;
  variant?: "compact" | "full";
  context?: PrimarySponsorContext;
  entityName?: string;
}

export function PrimarySponsorDisplay({ sponsorId, variant = "compact", context = "club_page", entityName }: PrimarySponsorDisplayProps) {
  const { trackView, trackClick } = useSponsorAnalytics();
  
  const { data: sponsor, isLoading } = useQuery({
    queryKey: ["sponsor", sponsorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, website_url, description, tier")
        .eq("id", sponsorId!)
        .single();
      if (error) throw error;
      return data as Sponsor;
    },
    enabled: !!sponsorId,
    // Sponsors change rarely — cache aggressively to eliminate the ~12k/day
    // duplicate PK lookups this component was generating across mounts.
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Track view when sponsor is displayed
  useEffect(() => {
    if (sponsor?.id) {
      trackView(sponsor.id, context);
    }
  }, [sponsor?.id, context, trackView]);

  if (!sponsorId || isLoading || !sponsor) {
    return null;
  }

  const handleClick = () => {
    trackClick(sponsor.id, context);
  };

  const handleBannerClick = () => {
    if (sponsor.website_url) {
      handleClick();
      safeOpenUrl(sponsor.website_url);
    }
  };

  if (variant === "compact") {
    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border ${sponsor.website_url ? "cursor-pointer hover:bg-muted/70 transition-colors" : ""}`}
        onClick={handleBannerClick}
      >
        <span className="text-xs text-muted-foreground">
          {entityName ? `Proud sponsor of ${entityName}` : "Sponsored by"}
        </span>
        <Avatar className="h-5 w-5">
          <AvatarImage src={sponsor.logo_url || undefined} />
          <AvatarFallback className="text-[10px] bg-secondary">
            {sponsor.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium">{sponsor.name}</span>
        {sponsor.tier && (
          <Badge variant="outline" className={`text-[10px] rounded-md ${TIER_CONFIG[sponsor.tier].bgColor} ${TIER_CONFIG[sponsor.tier].textColor} border-transparent`}>
            {TIER_CONFIG[sponsor.tier].label}
          </Badge>
        )}
        {sponsor.website_url && (
          <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <div
      className={`p-4 rounded-xl bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 ${sponsor.website_url ? "cursor-pointer hover:from-primary/10 hover:to-primary/15 transition-colors" : ""}`}
      onClick={handleBannerClick}
    >
      <div className="flex items-center gap-4">
        <Avatar className="h-14 w-14 border-2 border-primary/20">
          <AvatarImage src={sponsor.logo_url || undefined} />
          <AvatarFallback className="text-lg bg-primary/10 text-primary">
            {sponsor.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            {sponsor.tier ? `${TIER_CONFIG[sponsor.tier].label} Partner` : entityName ? `Proud Sponsor of ${entityName}` : "Proud Sponsor"}
          </p>
          <h3 className="font-semibold text-lg truncate">{sponsor.name}</h3>
          {sponsor.description && (
            <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{sponsor.description}</p>
          )}
        </div>
        {sponsor.website_url && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleBannerClick();
            }}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 transition-colors"
          >
            Visit site
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
