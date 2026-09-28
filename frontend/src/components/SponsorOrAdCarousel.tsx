import { useEffect, useRef, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MessagesSponsorCarousel } from "@/components/MessagesSponsorCarousel";
import { AppAdCarousel } from "@/components/AppAdCarousel";
import { AdMobBannerZone } from "@/components/AdMobBannerZone";
import { useAuth } from "@/hooks/useAuth";
import { readAdTierHint, writeAdTierHint, type AdTierHint } from "@/lib/adTierHint";

interface SponsorOrAdCarouselProps {
  location: "home" | "events" | "messages" | "event-detail" | "schedule";
  activeClubFilter?: string | null;
}

// Reserve vertical space matching the ad card height (h-28 = 112px) plus a
// little breathing room so the layout doesn't shift when the ad resolves.
const RESERVED_CLASS = "min-h-[112px]";

// Events sponsor strip is per-club opt-in via clubs.events_sponsor_strip_enabled.

export function SponsorOrAdCarousel({ location, activeClubFilter }: SponsorOrAdCarouselProps) {
  const { user, initialized } = useAuth();

  // Read the persisted tier hint synchronously on first render so that on
  // cold load we can render the correct ad component immediately, in parallel
  // with the rest of the page, instead of waiting for the pro-status query.
  const [initialHint] = useState<AdTierHint | null>(() =>
    readAdTierHint(location, user?.id, activeClubFilter ?? null),
  );
  const hintWrittenRef = useRef(false);
  const isEventsPlacement = location === "events" || location === "event-detail";

  // Events-placement gate: any club that has events_sponsor_strip_enabled = true.
  // If no filter is set, pick the first such club the user is a member of.
  const { data: eventsStripResolved, isLoading: isStripGateLoading } = useQuery({
    queryKey: ["events-sponsor-strip-allowed", activeClubFilter],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (activeClubFilter) {
        const { data, error } = await supabase
          .from("clubs")
          .select("events_sponsor_strip_enabled")
          .eq("id", activeClubFilter)
          .maybeSingle();
        if (error) throw error;
        const allowed = !!(data as any)?.events_sponsor_strip_enabled;
        return { allowed, effectiveClubId: allowed ? activeClubFilter : null };
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { allowed: false, effectiveClubId: null as string | null };

      const { data: directRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user.id);
      if (rolesError) throw rolesError;

      const clubIds = new Set<string>();
      (directRoles ?? []).forEach((r: any) => { if (r.club_id) clubIds.add(r.club_id); });
      const teamIds = (directRoles ?? []).map((r: any) => r.team_id).filter(Boolean);
      if (teamIds.length) {
        const { data: teams, error: teamsError } = await supabase
          .from("teams").select("club_id").in("id", teamIds);
        if (teamsError) throw teamsError;
        (teams ?? []).forEach((t: any) => t.club_id && clubIds.add(t.club_id));
      }
      if (clubIds.size === 0) return { allowed: false, effectiveClubId: null };

      const { data: enabledClubs, error: enabledError } = await supabase
        .from("clubs")
        .select("id, events_sponsor_strip_enabled")
        .in("id", Array.from(clubIds));
      if (enabledError) throw enabledError;
      const hit = (enabledClubs ?? []).find((c: any) => c.events_sponsor_strip_enabled);
      return { allowed: !!hit, effectiveClubId: hit?.id ?? null };
    },
    enabled: isEventsPlacement,
  });

  const eventsStripAllowed = eventsStripResolved?.allowed ?? false;
  // For events placement, scope downstream Pro/sponsor lookups to the pilot club
  // so the strip renders even when the user hasn't explicitly filtered to it.
  const effectiveClubFilter = isEventsPlacement && eventsStripResolved?.effectiveClubId
    ? eventsStripResolved.effectiveClubId
    : activeClubFilter ?? null;


  // Check Pro status per-club (filtered club) or globally (no filter)
  // Scoped to user.id so a device swap doesn't leak the previous user's pro
  // status. `placeholderData: (prev) => prev` keeps the last known answer
  // visible during WebView resume/refetch — critical so we don't flash a
  // free-club "Upgrade to Pro" ad to a paying Pro user while the query
  // re-resolves after the app was backgrounded.
  const { data: proStatus, isLoading: isProLoading, isFetching: isProFetching } = useQuery({
    queryKey: ["user-pro-status-per-club", user?.id, effectiveClubFilter],
    enabled: !!user,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async () => {
      // Get all clubs the user belongs to
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);
      // Propagate transient errors so react-query keeps previous data rather
      // than caching a network/RLS hiccup as an authoritative "Free" answer
      // (which would flash an "Upgrade to Pro" ad on a Pro club after a
      // network blip).
      if (rolesError) throw rolesError;

      if (!roles || roles.length === 0) return { isProFiltered: false, hasAnyPro: false, resolved: true };

      const clubIds = roles.filter(r => r.club_id).map(r => r.club_id);
      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id);

      // Get club IDs from teams
      if (teamIds.length > 0) {
        const { data: teams, error: teamsError } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        if (teamsError) throw teamsError;
        if (teams) {
          clubIds.push(...teams.map(t => t.club_id));
        }
      }

      const uniqueClubIds = [...new Set(clubIds.filter(Boolean))];
      if (uniqueClubIds.length === 0) return { isProFiltered: false, hasAnyPro: false, resolved: true };

      // Fetch Pro subscriptions for all user clubs
      const { data: subscriptions, error: subsError } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro")
        .in("club_id", uniqueClubIds)
        .eq("is_pro", true);
      if (subsError) throw subsError;

      const proClubIds = new Set(subscriptions?.map(s => s.club_id) || []);
      const hasAnyPro = proClubIds.size > 0;

      // If filtered to a specific club, check if THAT club is Pro
      const isProFiltered = effectiveClubFilter ? proClubIds.has(effectiveClubFilter) : hasAnyPro;

      return { isProFiltered, hasAnyPro, resolved: true };
    },
  });

  // Check ad settings for this location
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

  // Check if user has any ACTIVE sponsors (from sponsors table, not primary_sponsor_id)
  const { data: hasSponsors } = useQuery({
    queryKey: ["user-has-active-sponsors", effectiveClubFilter],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      if (effectiveClubFilter) {
        // Check if this specific club has active sponsors
        const { data, error } = await supabase
          .from("sponsors")
          .select("id")
          .eq("club_id", effectiveClubFilter)
          .eq("is_active", true)
          .limit(1);
        if (error) throw error;
        return !!data && data.length > 0;
      }

      // Check all user's clubs for active sponsors
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user.id);
      if (rolesError) throw rolesError;

      if (!roles || roles.length === 0) return false;

      const clubIds = roles.filter(r => r.club_id).map(r => r.club_id);
      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id);

      if (teamIds.length > 0) {
        const { data: teams, error: teamsError } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        if (teamsError) throw teamsError;
        if (teams) {
          clubIds.push(...teams.map(t => t.club_id));
        }
      }

      const uniqueClubIds = [...new Set(clubIds.filter(Boolean))];
      if (uniqueClubIds.length === 0) return false;

      const { data: sponsors, error: sponsorsError } = await supabase
        .from("sponsors")
        .select("id")
        .in("club_id", uniqueClubIds)
        .eq("is_active", true)
        .limit(1);
      if (sponsorsError) throw sponsorsError;

      return !!sponsors && sponsors.length > 0;
    },
  });

  const isProFiltered = proStatus?.isProFiltered ?? false;
  const proResolved = !!proStatus?.resolved;
  const isNative = !!(window as any).Capacitor;

  // Decide the resolved tier once all inputs have settled.
  const resolvedTier: AdTierHint | null = (() => {
    if (!initialized || !user || isProLoading || !proResolved) return null;
    if (isEventsPlacement && isStripGateLoading) return null;
    if (isEventsPlacement && !eventsStripAllowed) return "none";
    if (isProFiltered) {
      if (hasSponsors === undefined) return null;
      if (hasSponsors) return location === "home" ? "none" : "pro-sponsors";
      return "pro-none";
    }
    if (settings === undefined) return null;
    return settings?.is_enabled ? "free-ads" : "none";
  })();

  // Persist the resolved outcome so the next cold load renders instantly.
  useEffect(() => {
    if (!resolvedTier || hintWrittenRef.current) return;
    hintWrittenRef.current = true;
    writeAdTierHint(location, user?.id, activeClubFilter ?? null, resolvedTier);
  }, [resolvedTier, location, user?.id, activeClubFilter]);

  // Prefer the resolved tier; on cold load fall back to the persisted hint so
  // the ad renders at the same time as the rest of the page.
  const effectiveTier: AdTierHint | null = resolvedTier ?? initialHint;

  const renderReserved = () => (
    <>
      <div className={RESERVED_CLASS} aria-hidden="true" />
      {isNative && <AdMobBannerZone show={true} />}
    </>
  );

  if (effectiveTier === null) {
    // Unknown tier and still resolving → reserve space so layout is stable.
    return renderReserved();
  }

  if (effectiveTier === "none") {
    return isNative ? <AdMobBannerZone show={true} /> : null;
  }

  if (effectiveTier === "pro-sponsors") {
    return (
      <>
        <MessagesSponsorCarousel activeClubFilter={effectiveClubFilter} />
        {isNative && <AdMobBannerZone show={true} />}
      </>
    );
  }

  if (effectiveTier === "pro-none") {
    return isNative ? <AdMobBannerZone show={true} /> : null;
  }

  // effectiveTier === "free-ads"
  return (
    <>
      <AppAdCarousel
        location={location}
        hasSponsorAds={false}
        suppressUpgradeAdsForProUsers={false}
      />
      {isNative && <AdMobBannerZone show={true} />}
    </>
  );
}
