import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdAnalytics } from "@/hooks/useAdAnalytics";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { openAdLink } from "@/lib/adLinkNavigation";
import {
  CHAT_THREAD_SPONSOR_SLOT_PLACEMENT,
  SponsorSlotPresentation,
  useRotatingSponsorSlotIndex,
  useTieredSponsorSlot,
  type SponsorTier,
} from "@/components/sponsor/SponsorSlotPresentation";

// Pro club sponsor strip dismissal — 24h hide, user+club scoped.
// Free clubs (app ads) cannot dismiss.
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const dismissKey = (userId: string | undefined, clubId: string) =>
  `ignite_chat_sponsor_dismissed_${userId || "anon"}_${clubId}`;

interface ChatThreadSponsorStripProps {
  /** The club this chat thread belongs to. Pass `null` for DMs / unscoped chats — strip will hide. */
  clubId: string | null | undefined;
}

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
  description: string | null;
  ad_type: "image" | "logo_text";
  logo_url: string | null;
  headline: string | null;
}

/**
 * Slim sponsor/ad strip rendered at the top of a chat thread.
 *
 * - Renders nothing unless:
 *   1. A `clubId` is provided.
 *   2. The owning club has `chat_thread_ads_enabled = true`.
 *   3. The app-level `app_ad_settings` row for `chat-thread` is enabled.
 *   4. There's a sponsor (Pro club) or app ad (Free club) to show.
 *
 * Pro club  → shows one of the club's active sponsors (compact row).
 * Free club → shows the next active app ad (compact row).
 *
 * Lives as a sibling ABOVE the Virtuoso scroller — never inside it, never sticky,
 * never blurred. Zero impact on chat virtualisation.
 */
export function ChatThreadSponsorStrip({ clubId }: ChatThreadSponsorStripProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { trackView: trackSponsorView, trackClick: trackSponsorClick } = useSponsorAnalytics();
  const { trackView: trackAdView, trackClick: trackAdClick } = useAdAnalytics();
  const [dismissed, setDismissed] = useState(false);

  // Load dismissal state (Pro-only feature, but we read it whenever clubId/user changes)
  useEffect(() => {
    if (!clubId) return;
    try {
      const raw = localStorage.getItem(dismissKey(user?.id, clubId));
      if (!raw) {
        setDismissed(false);
        return;
      }
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS) {
        setDismissed(true);
      } else {
        localStorage.removeItem(dismissKey(user?.id, clubId));
        setDismissed(false);
      }
    } catch {
      setDismissed(false);
    }
  }, [clubId, user?.id]);

  const handleDismiss = () => {
    if (!clubId) return;
    try {
      localStorage.setItem(dismissKey(user?.id, clubId), String(Date.now()));
    } catch {
      // ignore quota errors
    }
    setDismissed(true);
  };

  // 1. Club-level opt-in
  const { data: clubFlag } = useQuery({
    queryKey: ["club-chat-thread-ads-enabled", clubId],
    enabled: !!clubId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, chat_thread_ads_enabled")
        .eq("id", clubId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const clubEnabled = !!clubFlag?.chat_thread_ads_enabled;

  // 2. App-level placement enabled?
  const { data: placementSettings } = useQuery({
    queryKey: ["app-ad-settings", "chat-thread"],
    enabled: clubEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_settings")
        .select("is_enabled")
        .eq("location", "chat-thread")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const placementEnabled = !!placementSettings?.is_enabled;

  // 3. Is this club Pro?
  const { data: isProClub } = useQuery({
    queryKey: ["club-is-pro", clubId],
    enabled: clubEnabled && placementEnabled && !!clubId,
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

  // 4a. Pro path — fetch this club's active sponsors (with tier for weighted rotation)
  const { data: sponsors = [] } = useQuery({
    queryKey: ["chat-thread-strip-sponsors", clubId],
    enabled: clubEnabled && placementEnabled && isProClub === true,
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

  // 4b. Free path — fetch active app ads
  const { data: appAds = [] } = useQuery({
    queryKey: ["chat-thread-strip-app-ads"],
    enabled: clubEnabled && placementEnabled && isProClub === false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ads")
        .select("id, name, image_url, link_url, description, ad_type, logo_url, headline")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data || []) as AppAdLite[];
    },
  });

  const activeSponsor = useTieredSponsorSlot(sponsors, isProClub === true);
  const adIndex = useRotatingSponsorSlotIndex(appAds.length, isProClub === false);

  const activeAd = useMemo(
    () => (isProClub === false && appAds.length > 0 ? appAds[adIndex % appAds.length] : null),
    [isProClub, appAds, adIndex],
  );

  // Track impressions
  useEffect(() => {
    if (activeSponsor && user?.id) {
      trackSponsorView(activeSponsor.id, "messages_page");
    }
  }, [activeSponsor?.id, user?.id, trackSponsorView]);

  useEffect(() => {
    if (activeAd && user?.id) {
      trackAdView(activeAd.id, "messages_page");
    }
  }, [activeAd?.id, user?.id, trackAdView]);

  // Gate
  if (!clubId || !clubEnabled || !placementEnabled) return null;
  if (isProClub === undefined) return null; // still loading
  if (!activeSponsor && !activeAd) return null;
  // Pro clubs can dismiss the strip; free clubs cannot (app ads always show).
  if (isProClub && dismissed) return null;

  // Pro club: sponsor row
  if (activeSponsor) {
    return (
      <SponsorSlotPresentation
        placement={CHAT_THREAD_SPONSOR_SLOT_PLACEMENT}
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

  // Free club: app ad row
  if (activeAd) {
    return (
      <SponsorSlotPresentation
        placement={CHAT_THREAD_SPONSOR_SLOT_PLACEMENT}
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
