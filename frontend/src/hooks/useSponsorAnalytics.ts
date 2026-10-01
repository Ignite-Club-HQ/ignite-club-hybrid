import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { recordLiveSponsorMetric } from "@/live/features/insights";

type EventType = "view" | "click";
type Context = "club_page" | "team_page" | "club_card" | "event_page" | "event_card" | "home_page" | "messages_page";

// Track which sponsors have been viewed to avoid duplicate tracking in a session
const viewedSponsors = new Set<string>();

async function recordSponsorEvent(sponsorId: string, eventType: EventType, context: Context) {
  await withFeatureBackend("analytics", {
    supabase: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("sponsor_analytics").insert({
        sponsor_id: sponsorId,
        event_type: eventType,
        context,
        user_id: user?.id ?? null,
      });
    },
    icp: async (ctx) => {
      // Canister per-sponsor metric counter has no `context` dimension — the
      // metric key folds event type + context into one string so per-context
      // breakdowns stay queryable via get_sponsor_performance, even though
      // there is no per-user attribution (record_sponsor_metric takes no
      // user id, unlike the Supabase row).
      await recordLiveSponsorMetric(ctx, sponsorId, `${eventType}:${context}`, 1);
    },
  });
}

export function useSponsorAnalytics() {
  const pendingTracksRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const trackEvent = useCallback(async (
    sponsorId: string,
    eventType: EventType,
    context: Context
  ) => {
    // For views, debounce and dedupe within the session
    if (eventType === "view") {
      const key = `${sponsorId}-${context}`;

      // Skip if already tracked this session
      if (viewedSponsors.has(key)) {
        return;
      }

      // Cancel any pending track for this sponsor/context
      const existing = pendingTracksRef.current.get(key);
      if (existing) {
        clearTimeout(existing);
      }

      // Debounce view tracking by 1 second
      const timeout = setTimeout(async () => {
        viewedSponsors.add(key);
        pendingTracksRef.current.delete(key);
        await recordSponsorEvent(sponsorId, eventType, context);
      }, 1000);

      pendingTracksRef.current.set(key, timeout);
    } else {
      // Clicks are tracked immediately
      await recordSponsorEvent(sponsorId, eventType, context);
    }
  }, []);

  const trackView = useCallback((sponsorId: string, context: Context) => {
    trackEvent(sponsorId, "view", context);
  }, [trackEvent]);

  const trackClick = useCallback((sponsorId: string, context: Context) => {
    trackEvent(sponsorId, "click", context);
  }, [trackEvent]);

  return { trackView, trackClick };
}
