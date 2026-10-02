import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { setLiveTyping, listLiveTyping } from "@/live/features/messaging";
import { RealtimeChannel } from "@supabase/supabase-js";

interface TypingUser {
  id: string;
  name: string;
}

export function useTypingIndicator(
  channelName: string,
  userId?: string,
  userName?: string
) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const routedToIcp = isFeatureRoutedToIcp("messaging");

  // ICP path: poll list_typing for the conversation on a short interval
  // instead of opening a Supabase presence channel.
  const { data: icpTypingUsers } = useQuery({
    queryKey: ["typing-icp", channelName],
    queryFn: () =>
      withFeatureBackend("messaging", {
        supabase: async () => [],
        icp: (ctx) => listLiveTyping(ctx, channelName),
      }),
    enabled: routedToIcp && !!userId && !!channelName,
    refetchInterval: 2500,
  });

  useEffect(() => {
    if (!routedToIcp) return;
    const mapped = (icpTypingUsers ?? [])
      .filter((t) => t.user.toText() !== userId)
      .map((t) => ({ id: t.user.toText(), name: t.name || "Someone" }));
    setTypingUsers(mapped);
  }, [routedToIcp, icpTypingUsers, userId]);

  useEffect(() => {
    // Presence has no canister equivalent — on ICP typing indicators are
    // driven by the polling query above rather than a Supabase channel.
    if (!userId || !channelName || routedToIcp) return;

    const channel = supabase.channel(`typing:${channelName}`);
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const typing: TypingUser[] = [];
        
        Object.values(state).forEach((presences: any[]) => {
          presences.forEach((presence) => {
            if (presence.isTyping && presence.userId !== userId) {
              typing.push({ id: presence.userId, name: presence.userName || "Someone" });
            }
          });
        });
        
        setTypingUsers(typing);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            userId,
            userName: userName || "Someone",
            isTyping: false,
          });
        }
      });

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [channelName, userId, userName]);

  const setTyping = useCallback(
    async (isTyping: boolean) => {
      if (!userId || !channelName) return;

      if (routedToIcp) {
        // Avoid sending duplicate states
        if (isTypingRef.current === isTyping) return;
        isTypingRef.current = isTyping;

        await withFeatureBackend("messaging", {
          supabase: async () => {},
          icp: (ctx) => setLiveTyping(ctx, channelName, isTyping, userName || "Someone"),
        }).catch(() => {});

        if (isTyping) {
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
          }
          typingTimeoutRef.current = setTimeout(() => {
            isTypingRef.current = false;
            withFeatureBackend("messaging", {
              supabase: async () => {},
              icp: (ctx) => setLiveTyping(ctx, channelName, false, userName || "Someone"),
            }).catch(() => {});
          }, 3000);
        }
        return;
      }

      if (!channelRef.current) return;

      // Avoid sending duplicate states
      if (isTypingRef.current === isTyping) return;
      isTypingRef.current = isTyping;

      await channelRef.current.track({
        userId,
        userName: userName || "Someone",
        isTyping,
      });

      // Auto-stop typing after 3 seconds of no input
      if (isTyping) {
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
        typingTimeoutRef.current = setTimeout(() => {
          isTypingRef.current = false;
          channelRef.current?.track({
            userId,
            userName: userName || "Someone",
            isTyping: false,
          });
        }, 3000);
      }
    },
    [userId, userName, channelName, routedToIcp]
  );

  const startTyping = useCallback(() => setTyping(true), [setTyping]);
  const stopTyping = useCallback(() => setTyping(false), [setTyping]);

  return { typingUsers, startTyping, stopTyping };
}
