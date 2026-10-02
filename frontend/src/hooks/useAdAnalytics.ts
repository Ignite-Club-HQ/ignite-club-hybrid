import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { recordLiveAdEvent } from "@/live/features/insights";

type EventType = "view" | "click";
type Context = "home_page" | "events_page" | "event_detail_page" | "messages_page" | "schedule_page";

// Track which ads have been viewed to avoid duplicate tracking in a session
const viewedAds = new Set<string>();

// Routes to the insights_domain canister under the ICP backend; the Supabase
// branch keeps the existing app_ad_analytics insert.
async function recordAdEvent(adId: string, eventType: EventType, context: Context) {
  await withFeatureBackend("analytics", {
    supabase: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("app_ad_analytics").insert({
        ad_id: adId,
        event_type: eventType,
        context,
        user_id: user?.id || null,
      });
    },
    icp: async (ctx) => {
      await recordLiveAdEvent(ctx, adId, eventType, context);
    },
  });
}

export function useAdAnalytics() {
  const pendingTracksRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const trackEvent = useCallback(async (
    adId: string,
    eventType: EventType,
    context: Context
  ) => {
    // For views, debounce and dedupe within the session
    if (eventType === "view") {
      const key = `${adId}-${context}`;
      
      // Skip if already tracked this session
      if (viewedAds.has(key)) {
        return;
      }

      // Cancel any pending track for this ad/context
      const existing = pendingTracksRef.current.get(key);
      if (existing) {
        clearTimeout(existing);
      }

      // Debounce view tracking by 1 second
      const timeout = setTimeout(async () => {
        viewedAds.add(key);
        pendingTracksRef.current.delete(key);
        await recordAdEvent(adId, eventType, context);
      }, 1000);

      pendingTracksRef.current.set(key, timeout);
    } else {
      // Clicks are tracked immediately
      await recordAdEvent(adId, eventType, context);
    }
  }, []);

  const trackView = useCallback((adId: string, context: Context) => {
    trackEvent(adId, "view", context);
  }, [trackEvent]);

  const trackClick = useCallback((adId: string, context: Context) => {
    trackEvent(adId, "click", context);
  }, [trackEvent]);

  return { trackView, trackClick };
}
