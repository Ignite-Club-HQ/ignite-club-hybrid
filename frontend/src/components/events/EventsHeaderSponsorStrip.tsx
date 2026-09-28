import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdAnalytics } from "@/hooks/useAdAnalytics";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { openAdLink } from "@/lib/adLinkNavigation";
import { readStripHint, readAnyStripHint, writeStripHint } from "@/lib/stripContentHint";
import {
  CARD_SPONSOR_SLOT_PLACEMENT,
  SponsorSlotPresentation,
  useRotatingSponsorSlotIndex,
  useTieredSponsorSlot,
  type SponsorTier,
} from "@/components/sponsor/SponsorSlotPresentation";

const STRIP_KEY = "events_header";
// Height of the rendered strip row (avatar h-6 + py-2 + border) — reserved
// during first-ever cold load to prevent content-jump when queries resolve.
const RESERVED_CLASS = "min-h-[44px]";

// Any club may opt in via clubs.events_sponsor_strip_enabled.

const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const dismissKey = (userId: string | undefined, clubId: string) =>
  `ignite_events_header_sponsor_dismissed_${userId || "anon"}_${clubId}`;

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
 * Slim sponsor / ad strip rendered at the top of the Schedule (events list)
 * and Event Detail pages. Mirrors the Messages/Media header strip style.
 *
 * `activeClubFilter` may be null (no filter). When null, the strip resolves
 * to the pilot club if the current user is a member of it.
 */
export function EventsHeaderSponsorStrip({
  activeClubFilter,
}: {
  activeClubFilter: string | null | undefined;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { trackView: trackSponsorView, trackClick: trackSponsorClick } = useSponsorAnalytics();
  const { trackView: trackAdView, trackClick: trackAdClick } = useAdAnalytics();
  const [dismissed, setDismissed] = useState(false);

  // Resolve the effective club: prefer explicit filter; otherwise pick the
  // first club the user belongs to that has the strip toggle enabled.
  const { data: resolved, isSuccess: resolvedOk } = useQuery({
    queryKey: ["events-header-strip-resolve", activeClubFilter, user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (activeClubFilter) {
        const { data } = await supabase
          .from("clubs")
          .select("events_sponsor_strip_enabled")
          .eq("id", activeClubFilter)
          .maybeSingle();
        if (!(data as any)?.events_sponsor_strip_enabled) return { clubId: null as string | null };
        return { clubId: activeClubFilter };
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);
      const clubIds = new Set<string>();
      (roles ?? []).forEach((r: any) => r.club_id && clubIds.add(r.club_id));
      const teamIds = (roles ?? []).map((r: any) => r.team_id).filter(Boolean);
      if (teamIds.length) {
        const { data: teams } = await supabase
          .from("teams").select("club_id").in("id", teamIds);
        (teams ?? []).forEach((t: any) => t.club_id && clubIds.add(t.club_id));
      }
      if (clubIds.size === 0) return { clubId: null as string | null };
      const { data: enabledClubs } = await supabase
        .from("clubs")
        .select("id, events_sponsor_strip_enabled")
        .in("id", Array.from(clubIds));
      const hit = (enabledClubs ?? []).find((c: any) => c.events_sponsor_strip_enabled);
      return { clubId: hit?.id ?? null };
    },
  });
  const clubId = resolved?.clubId ?? null;

  useEffect(() => {
    if (!clubId) return;
    try {
      const raw = localStorage.getItem(dismissKey(user?.id, clubId));
      if (!raw) { setDismissed(false); return; }
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS) setDismissed(true);
      else { localStorage.removeItem(dismissKey(user?.id, clubId)); setDismissed(false); }
    } catch { setDismissed(false); }
  }, [clubId, user?.id]);

  const handleDismiss = () => {
    if (!clubId) return;
    try { localStorage.setItem(dismissKey(user?.id, clubId), String(Date.now())); } catch {}
    setDismissed(true);
  };

  const { data: isProClub, isSuccess: isProClubOk } = useQuery({
    queryKey: ["club-is-pro", clubId],
    enabled: !!clubId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro")
        .eq("club_id", clubId!)
        .eq("is_pro", true)
        .limit(1)
        .maybeSingle();
      return !!data?.is_pro;
    },
  });

  const { data: sponsors = [], isSuccess: sponsorsOk } = useQuery({
    queryKey: ["events-header-sponsors", clubId],
    enabled: !!clubId && isProClub === true,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, website_url, tier")
        .eq("club_id", clubId!)
        .eq("is_active", true)
        .order("name");
      return (data || []) as SponsorLite[];
    },
  });

  const { data: placementSettings, isSuccess: placementOk } = useQuery({
    queryKey: ["app-ad-settings", "events"],
    enabled: !!clubId && isProClub === false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_ad_settings")
        .select("is_enabled")
        .eq("location", "events")
        .maybeSingle();
      return data;
    },
  });
  const freePlacementEnabled = !!placementSettings?.is_enabled;

  const { data: appAds = [], isSuccess: appAdsOk } = useQuery({
    queryKey: ["events-header-app-ads"],
    enabled: !!clubId && isProClub === false && freePlacementEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_ads")
        .select("id, name, image_url, link_url, ad_type, logo_url, headline")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      return (data || []) as AppAdLite[];
    },
  });

  const activeSponsor = useTieredSponsorSlot(sponsors, isProClub === true);
  const adIndex = useRotatingSponsorSlotIndex(appAds.length, isProClub === false);

  const activeAd = useMemo(
    () => (isProClub === false && appAds.length > 0 ? appAds[adIndex % appAds.length] : null),
    [isProClub, appAds, adIndex],
  );

  useEffect(() => {
    if (activeSponsor && user?.id) trackSponsorView(activeSponsor.id, "event_page");
  }, [activeSponsor?.id, user?.id, trackSponsorView]);
  useEffect(() => {
    if (activeAd && user?.id) trackAdView(activeAd.id, "events_page");
  }, [activeAd?.id, user?.id, trackAdView]);

  // Determine whether the strip's async decision has fully resolved for this
  // user+club. Used to (a) persist the "has content" hint and (b) decide
  // whether to reserve vertical space while still loading (preventing CLS).
  const decisionResolved =
    resolvedOk &&
    (!clubId ||
      (isProClubOk &&
        (isProClub === true
          ? sponsorsOk
          : placementOk && (!freePlacementEnabled || appAdsOk))));

  const hasContent = !!activeSponsor || !!activeAd;

  // Persist outcome so the next cold load knows whether to reserve space.
  useEffect(() => {
    if (!decisionResolved) return;
    writeStripHint(STRIP_KEY, user?.id, clubId, hasContent);
  }, [decisionResolved, hasContent, user?.id, clubId]);

  // Read the previous hint on first render to decide whether to reserve
  // height while queries are still in flight. Unknown (first ever visit) →
  // reserve, so the very first cold load is also CLS-free.
  // When no club filter is active, the resolved club isn't known yet — fall
  // back to any stored hint for this user/strip so a known "no content"
  // outcome doesn't reserve-then-collapse (calendar jumping up on cold open).
  const [reserveOnLoad] = useState(() => {
    const hint = activeClubFilter
      ? readStripHint(STRIP_KEY, user?.id, activeClubFilter)
      : readAnyStripHint(STRIP_KEY, user?.id);
    return hint !== false; // reserve when true or unknown
  });

  const renderReserved = () =>
    reserveOnLoad ? <div className={RESERVED_CLASS} aria-hidden="true" /> : null;

  if (!decisionResolved) return renderReserved();
  if (!hasContent) return null;
  if (activeSponsor && dismissed) return null;

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
            trackSponsorClick(activeSponsor.id, "event_page");
            safeOpenUrl(activeSponsor.website_url!);
          },
          onDismiss: handleDismiss,
        }}
      />
    );
  }

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
            trackAdClick(activeAd.id, "events_page");
            openAdLink(activeAd.link_url, navigate, { clubId });
          },
        }}
      />
    );
  }

  return null;
}
