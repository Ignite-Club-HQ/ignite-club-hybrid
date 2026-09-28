import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdAnalytics } from "@/hooks/useAdAnalytics";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { openAdLink } from "@/lib/adLinkNavigation";
import { readStripHint, writeStripHint } from "@/lib/stripContentHint";
import {
  CARD_SPONSOR_SLOT_PLACEMENT,
  SponsorSlotPresentation,
  useRotatingSponsorSlotIndex,
  useTieredSponsorSlot,
  type SponsorTier,
} from "@/components/sponsor/SponsorSlotPresentation";

const STRIP_KEY = "media_header";
const RESERVED_CLASS = "min-h-[44px]";

// Pro sponsor strip: any Pro club that opts in via clubs.media_header_sponsors_enabled.
// Defaults to OFF (column default false); toggled in Club settings.

// Pro dismiss — 24h, user+club scoped. Free clubs cannot dismiss (same as chat).
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const dismissKey = (userId: string | undefined, clubId: string) =>
  `ignite_media_header_sponsor_dismissed_${userId || "anon"}_${clubId}`;

interface SponsorLite {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: SponsorTier;
}

interface AppAdLite {
  id: string;
  name: string;
  image_url: string | null;
  link_url: string | null;
  ad_type: "image" | "logo_text";
  logo_url: string | null;
  headline: string | null;
}

/**
 * Slim sponsor / ad strip rendered above the Media feed.
 *
 * Render rules (triple-checked):
 *   Pro path  → ONLY when clubId === RIVERSIDE && clubs.media_header_sponsors_enabled === true.
 *               Dismissible for 24h per user+club.
 *   Free path → Any free club, always on (mirrors messages strip). Not dismissible.
 *
 * If `clubId` is null/undefined (multi-club view), renders nothing.
 */
export function MediaHeaderSponsorStrip({ clubId }: { clubId: string | null | undefined }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { trackView: trackSponsorView, trackClick: trackSponsorClick } = useSponsorAnalytics();
  const { trackView: trackAdView, trackClick: trackAdClick } = useAdAnalytics();
  const [dismissed, setDismissed] = useState(false);

  // Dismiss state (Pro Riverside only)
  useEffect(() => {
    if (!clubId) return;
    try {
      const raw = localStorage.getItem(dismissKey(user?.id, clubId));
      if (!raw) { setDismissed(false); return; }
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS) {
        setDismissed(true);
      } else {
        localStorage.removeItem(dismissKey(user?.id, clubId));
        setDismissed(false);
      }
    } catch { setDismissed(false); }
  }, [clubId, user?.id]);

  const handleDismiss = () => {
    if (!clubId) return;
    try { localStorage.setItem(dismissKey(user?.id, clubId), String(Date.now())); } catch {}
    setDismissed(true);
  };

  // Is club Pro? (drives Pro vs Free path)
  const { data: isProClub, isSuccess: isProClubOk } = useQuery({
    queryKey: ["club-is-pro", clubId],
    enabled: !!clubId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_subscriptions")
        .select("is_pro")
        .eq("club_id", clubId!)
        .eq("is_pro", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return !!data?.is_pro;
    },
  });

  // Pro toggle — any Pro club that has opted in
  const { data: clubFlag, isSuccess: clubFlagOk } = useQuery({
    queryKey: ["media-header-sponsors-enabled", clubId],
    enabled: !!clubId && isProClub === true,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, media_header_sponsors_enabled")
        .eq("id", clubId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const proEnabled = !!clubFlag?.media_header_sponsors_enabled;

  // Pro sponsors
  const { data: sponsors = [], isSuccess: sponsorsOk } = useQuery({
    queryKey: ["media-header-sponsors", clubId],
    enabled: proEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, website_url, tier")
        .eq("club_id", clubId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as SponsorLite[];
    },
  });

  // Free app-ad placement gate — controlled by app admin in /admin/ads
  const { data: placementSettings, isSuccess: placementOk } = useQuery({
    queryKey: ["app-ad-settings", "media-header"],
    enabled: isProClub === false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_settings")
        .select("is_enabled")
        .eq("location", "media-header")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const freePlacementEnabled = !!placementSettings?.is_enabled;

  // Free app ads
  const { data: appAds = [], isSuccess: appAdsOk } = useQuery({
    queryKey: ["media-header-app-ads"],
    enabled: isProClub === false && freePlacementEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ads")
        .select("id, name, image_url, link_url, ad_type, logo_url, headline")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data || []) as AppAdLite[];
    },
  });

  // Tier-weighted Pro playlist
  const activeSponsor = useTieredSponsorSlot(sponsors, proEnabled);
  const adIndex = useRotatingSponsorSlotIndex(appAds.length, isProClub === false);

  const activeAd = useMemo(
    () => (isProClub === false && appAds.length > 0 ? appAds[adIndex % appAds.length] : null),
    [isProClub, appAds, adIndex],
  );

  // Impression tracking
  useEffect(() => {
    if (activeSponsor && user?.id) trackSponsorView(activeSponsor.id, "messages_page");
  }, [activeSponsor?.id, user?.id, trackSponsorView]);
  useEffect(() => {
    if (activeAd && user?.id) trackAdView(activeAd.id, "messages_page");
  }, [activeAd?.id, user?.id, trackAdView]);

  // Resolution / hint bookkeeping — see events strip for rationale.
  const decisionResolved =
    !clubId
      ? true
      : isProClubOk &&
        (isProClub === true
          ? clubFlagOk && (!proEnabled || sponsorsOk)
          : placementOk && (!freePlacementEnabled || appAdsOk));

  const hasContent = !!activeSponsor || !!activeAd;

  useEffect(() => {
    if (!decisionResolved) return;
    writeStripHint(STRIP_KEY, user?.id, clubId, hasContent);
  }, [decisionResolved, hasContent, user?.id, clubId]);

  const [reserveOnLoad] = useState(() => {
    const hint = readStripHint(STRIP_KEY, user?.id, clubId ?? null);
    return hint !== false;
  });

  const renderReserved = () =>
    reserveOnLoad ? <div className={RESERVED_CLASS} aria-hidden="true" /> : null;

  // Gates
  if (!clubId) return null;
  if (!decisionResolved) return renderReserved();
  if (!hasContent) return null;
  if (activeSponsor && dismissed) return null;

  // Pro Riverside: dismissible club-sponsor row
  if (activeSponsor) {
    return (
      <SponsorSlotPresentation
        placement={CARD_SPONSOR_SLOT_PLACEMENT}
        item={{
          kind: "sponsor",
          id: activeSponsor.id,
          name: activeSponsor.name,
          logoUrl: activeSponsor.logo_url,
          websiteUrl: activeSponsor.website_url,
          onActivate: () => {
            trackSponsorClick(activeSponsor.id, "messages_page");
            safeOpenUrl(activeSponsor.website_url!);
          },
          onDismiss: handleDismiss,
        }}
      />
    );
  }

  // Free: app ad row (always on)
  if (activeAd) {
    return (
      <SponsorSlotPresentation
        placement={CARD_SPONSOR_SLOT_PLACEMENT}
        item={{
          kind: "ad",
          id: activeAd.id,
          name: activeAd.name,
          imageUrl: activeAd.logo_url || activeAd.image_url,
          linkUrl: activeAd.link_url,
          headline: activeAd.headline,
          onActivate: () => {
            trackAdClick(activeAd.id, "messages_page");
            openAdLink(activeAd.link_url, navigate, { clubId });
          },
        }}
      />
    );
  }

  return null;
}
