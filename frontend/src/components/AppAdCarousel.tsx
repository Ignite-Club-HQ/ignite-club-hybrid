import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdAnalytics } from "@/hooks/useAdAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { openAdLink } from "@/lib/adLinkNavigation";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";

interface AppAdCarouselProps {
  location: "home" | "events" | "messages" | "event-detail" | "schedule";
  hasSponsorAds: boolean;
  /**
   * When true (default), upgrade-style ads are hidden from users who already have
   * Pro on any club. Set to false in contexts where the surrounding UI is scoped
   * to a free club — the upgrade nudge is relevant there even if the user has
   * Pro elsewhere.
   */
  suppressUpgradeAdsForProUsers?: boolean;
}

interface AppAd {
  id: string;
  name: string;
  image_url: string | null;
  link_url: string | null;
  description: string | null;
  ad_type: "image" | "logo_text";
  logo_url: string | null;
  headline: string | null;
  subtext: string | null;
  cta_label: string | null;
  bg_color: string | null;
  text_color: string | null;
}

export function AppAdCarousel({ location, hasSponsorAds, suppressUpgradeAdsForProUsers = true }: AppAdCarouselProps) {
  const { trackView, trackClick } = useAdAnalytics();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const { hasAnyClubPro, isLoading: proLoading } = useUserHasAnyClubPro();

  // Fetch user's admin scopes so we can route upgrade ads to a real upgrade URL
  const { data: adminScopes } = useQuery({
    queryKey: ["user-admin-upgrade-scopes", user?.id],
    queryFn: async () => {
      if (!user?.id) return { clubId: null as string | null, teamId: null as string | null };

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user.id)
        .in("role", ["club_admin", "team_admin"]);

      const clubId = roles?.find((r) => r.role === "club_admin" && r.club_id)?.club_id ?? null;
      const teamId = roles?.find((r) => r.role === "team_admin" && r.team_id)?.team_id ?? null;
      return { clubId, teamId };
    },
    enabled: !!user?.id,
  });

  const isAdmin = !!(adminScopes?.clubId || adminScopes?.teamId);


  // Fetch ad settings for this location
  const { data: settings } = useQuery({
    queryKey: ["app-ad-settings", location],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_settings")
        .select("*")
        .eq("location", location)
        .single();
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch active ads
  const { data: ads } = useQuery({
    queryKey: ["app-ads-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ads")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      return data as AppAd[];
    },
    enabled: !!settings?.is_enabled,
  });

  // Detect upgrade-style ads (used both for filtering and click routing).
  const isUpgradeAdRow = (ad: AppAd) =>
    !!ad.link_url?.includes("upgrade") ||
    ad.name.toLowerCase().includes("upgrade") ||
    ad.name.toLowerCase().includes("pro");

  // Filter out upgrade ads for users who already have Pro on any club.
  // While the Pro check is still loading we suppress upgrade ads to avoid the
  // "flash then disappear" behaviour after resuming from inactivity.
  const visibleAds = (ads ?? []).filter((ad) => {
    if (!isUpgradeAdRow(ad)) return true;
    if (!suppressUpgradeAdsForProUsers) return true;
    if (proLoading) return false;
    return !hasAnyClubPro;
  });

  // Determine if we should show ads
  const shouldShowAds = settings?.is_enabled && visibleAds.length > 0 && (
    settings.override_sponsors || 
    (settings.show_only_when_no_sponsors && !hasSponsorAds) ||
    (!settings.override_sponsors && !settings.show_only_when_no_sponsors)
  );

  // Auto-rotate ads
  useEffect(() => {
    if (visibleAds.length <= 1) return;
    
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % visibleAds.length);
    }, 8000);
    
    return () => clearInterval(interval);
  }, [visibleAds.length]);

  // Track view when ad is displayed
  useEffect(() => {
    if (shouldShowAds && visibleAds[currentIndex]) {
      const context = (
        location === "event-detail" ? "event_detail_page" : `${location}_page`
      ) as "home_page" | "events_page" | "event_detail_page" | "messages_page" | "schedule_page";
      trackView(visibleAds[currentIndex].id, context);
    }
  }, [shouldShowAds, visibleAds, currentIndex, location, trackView]);

  // Reset index if out of bounds
  useEffect(() => {
    if (currentIndex >= visibleAds.length) {
      setCurrentIndex(0);
    }
  }, [visibleAds.length, currentIndex]);

  if (!shouldShowAds || visibleAds.length === 0) {
    return null;
  }

  const currentAd = visibleAds[currentIndex];
  const context = (
    location === "event-detail" ? "event_detail_page" : `${location}_page`
  ) as "home_page" | "events_page" | "event_detail_page" | "messages_page" | "schedule_page";

  const isUpgradeAd = currentAd.link_url?.includes("upgrade") || 
                      currentAd.name.toLowerCase().includes("upgrade") ||
                      currentAd.name.toLowerCase().includes("pro");

  const handleClick = () => {
    trackClick(currentAd.id, context);
    
    // Special handling for upgrade ads
    if (isUpgradeAd) {
      // Non-admins can't upgrade — nudge them to contact their admin instead of bouncing to profile.
      if (!isAdmin) {
        toast({
          title: "Contact your club admin",
          description: "Only club or team admins can upgrade to Pro. Please ask your admin to upgrade for your club.",
        });
        return;
      }

      // Admin users go straight to the relevant upgrade page.
      if (adminScopes?.clubId) {
        navigate(`/clubs/${adminScopes.clubId}/upgrade`);
        return;
      }
      if (adminScopes?.teamId) {
        navigate(`/teams/${adminScopes.teamId}/upgrade`);
        return;
      }
      // Fallback if scopes haven't resolved yet
      toast({
        title: "Upgrade unavailable",
        description: "We couldn't find a club or team to upgrade. Please try again from your club page.",
      });
      return;
    }

    
    openAdLink(currentAd.link_url, navigate, adminScopes ?? undefined);
  };

  return (
    <div className="w-full">
      <div
        className="relative rounded-lg overflow-hidden cursor-pointer group"
        onClick={handleClick}
      >
        {currentAd.ad_type === "logo_text" ? (
          <div
            className="w-full h-28 flex items-center gap-3 px-4 transition-transform group-hover:scale-[1.02]"
            style={{
              backgroundColor: currentAd.bg_color || "hsl(var(--card))",
              color: currentAd.text_color || "hsl(var(--card-foreground))",
            }}
          >
            {currentAd.logo_url && (
              <img
                src={currentAd.logo_url}
                alt=""
                className="h-16 w-16 rounded-md object-contain bg-white/10 shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base leading-tight truncate">
                {currentAd.headline || currentAd.name}
              </div>
              {currentAd.subtext && (
                <div className="text-sm opacity-80 line-clamp-2 mt-0.5">{currentAd.subtext}</div>
              )}
            </div>
            {currentAd.cta_label && (
              <span
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full bg-white/20"
              >
                {currentAd.cta_label}
              </span>
            )}
          </div>
        ) : (
          <img
            src={currentAd.image_url || ""}
            alt={currentAd.name}
            className="w-full h-28 object-contain transition-transform group-hover:scale-[1.02]"
          />
        )}
        <div className="absolute top-2 right-2">
          <span className="text-[10px] bg-black/40 text-white/70 px-1.5 py-0.5 rounded">Ad</span>
        </div>
      </div>
      
      {/* Pagination dots */}
      {visibleAds.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {visibleAds.map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(index);
              }}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                index === currentIndex ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
