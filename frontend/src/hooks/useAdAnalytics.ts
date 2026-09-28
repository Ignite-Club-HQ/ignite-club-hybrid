import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type EventType = "view" | "click";
type Context = "home_page" | "events_page" | "event_detail_page" | "messages_page" | "schedule_page";

// Track which ads have been viewed to avoid duplicate tracking in a session
const viewedAds = new Set<string>();

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
        
        const { data: { user } } = await supabase.auth.getUser();
        
        await supabase.from("app_ad_analytics").insert({
          ad_id: adId,
          event_type: eventType,
          context,
          user_id: user?.id || null,
        });
      }, 1000);

      pendingTracksRef.current.set(key, timeout);
    } else {
      // Clicks are tracked immediately
      const { data: { user } } = await supabase.auth.getUser();
      
      await supabase.from("app_ad_analytics").insert({
        ad_id: adId,
        event_type: eventType,
        context,
        user_id: user?.id || null,
      });
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
