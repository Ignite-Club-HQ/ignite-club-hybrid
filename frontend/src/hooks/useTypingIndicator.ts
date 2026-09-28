import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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

  useEffect(() => {
    if (!userId || !channelName) return;

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
      if (!channelRef.current || !userId) return;
      
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
    [userId, userName]
  );

  const startTyping = useCallback(() => setTyping(true), [setTyping]);
  const stopTyping = useCallback(() => setTyping(false), [setTyping]);

  return { typingUsers, startTyping, stopTyping };
}
