import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/hooks/useAuth";
import { useUnreadMessageCounts } from "@/hooks/useUnreadMessageCounts";
import { Badge } from "@/components/ui/badge";
import { getProfileFromCache } from "@/lib/profileCache";

import { formatMessagePreview as stripMentionFormatting, extractEventIds } from "@/lib/messagePreview";
import { isSystemMessageLike } from "@/lib/systemMessagePatterns";


interface TeamChatPreviewProps {
  teamId: string;
}

export function TeamChatPreview({ teamId }: TeamChatPreviewProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();



  // Latest message reads denormalised columns kept fresh by
  // tg_team_messages_update_parent_preview on the teams row.
  // Single indexed row read, no profile join, no message-table scan.
  const { data: latestMessage } = useQuery({
    queryKey: ["team-chat-preview", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select(
          "last_message_id, last_message_text, last_message_at, last_message_author_id, last_message_author_name, last_message_is_system, last_message_is_club_announcement, last_message_club_announcement_name"
        )
        .eq("id", teamId)
        .maybeSingle();

      if (!data || !data.last_message_id) return null;

      const authorName = data.last_message_is_club_announcement
        ? data.last_message_club_announcement_name || "Club"
        : data.last_message_author_name || "Someone";

      return {
        id: data.last_message_id,
        text: data.last_message_text ?? "",
        created_at: data.last_message_at,
        author_id: data.last_message_author_id,
        is_club_announcement: data.last_message_is_club_announcement,
        club_announcement_name: data.last_message_club_announcement_name,
        is_system_message: data.last_message_is_system,
        authorName,
      };
    },
    enabled: !!teamId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  // Realtime patch (both web and native): a single team-filtered subscription
  // that writes the new preview straight into this query's cache. No
  // invalidation and no refetch, so it can't contribute to the invalidation
  // storms that caused the Android WebView freezes — the 60s poll above stays
  // as a backstop/reconciler for author names and missed events.
  useEffect(() => {
    if (!teamId) return;
    const channel = supabase
      .channel(`team-chat-preview-${teamId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "team_messages", filter: `team_id=eq.${teamId}` },
        (payload: any) => {
          const row = payload.new;
          if (!row) return;
          queryClient.setQueryData(["team-chat-preview", teamId], (old: any) => {
            const isAnnouncement = !!row.is_club_announcement;
            const authorName = isAnnouncement
              ? row.club_announcement_name || "Club"
              : row.author_id === user?.id
                ? "You"
                : getProfileFromCache(row.author_id)?.display_name || old?.authorName || "Someone";
            return {
              id: row.id,
              text: row.text ?? "",
              created_at: row.created_at,
              author_id: row.author_id ?? null,
              is_club_announcement: isAnnouncement,
              club_announcement_name: row.club_announcement_name ?? null,
              is_system_message: !!row.is_system_message,
              authorName,
            };
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "team_messages", filter: `team_id=eq.${teamId}` },
        (payload: any) => {
          const row = payload.new;
          if (!row) return;
          // Edits: only patch when the edited row IS the previewed message.
          queryClient.setQueryData(["team-chat-preview", teamId], (old: any) => {
            if (!old || old.id !== row.id) return old;
            return { ...old, text: row.text ?? "" };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, user?.id, queryClient]);



  // Resolve event titles referenced in the latest message so previews
  // show the actual event name instead of a generic "Event" placeholder.
  const referencedEventIds = extractEventIds(latestMessage?.text);
  const eventIdsKey = referencedEventIds.join(",");
  const { data: eventTitleMap } = useQuery({
    queryKey: ["team-chat-preview-event-titles", eventIdsKey],
    queryFn: async () => {
      if (referencedEventIds.length === 0) return {} as Record<string, string>;
      const { data } = await supabase
        .from("events")
        .select("id, title")
        .in("id", referencedEventIds);
      const map: Record<string, string> = {};
      (data || []).forEach((e) => {
        if (e?.id && e?.title) map[e.id.toLowerCase()] = e.title;
      });
      return map;
    },
    enabled: referencedEventIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Unread count: derived from the shared `unread-message-counts` cache so this
  // badge inherits the bell's realtime push (via useAuth's notifications
  // channel) AND the optimistic decrement in markChatScopeNotificationsRead.
  // Previously this component ran its own message_reads + team_messages scan
  // with a 60s poll and no realtime, causing up to 60s of lag while every
  // other unread indicator updated instantly.
  const { data: unreadCount = 0 } = useUnreadMessageCounts(user?.id, {
    enabled: !!teamId && !!user?.id,
    select: (counts) => counts.teams[teamId] ?? 0,
  });

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold">Team Chat</span>
        {latestMessage ? (
          <p className="text-[11px] text-muted-foreground truncate">
            {isSystemMessageLike(latestMessage.text, (latestMessage as any).is_system_message) ? (
              <span className="italic">{stripMentionFormatting(latestMessage.text, eventTitleMap)}</span>
            ) : (
              <>
                <span className="font-medium">
                  {latestMessage.author_id === user?.id ? "You" : latestMessage.authorName}:
                </span>{" "}
                {(() => {
                  const clean = stripMentionFormatting(latestMessage.text, eventTitleMap);
                  return clean.length > 40 ? clean.slice(0, 40) + "…" : clean;
                })()}
              </>
            )}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">No messages yet — say hello! 👋</p>
        )}
      </div>
      {unreadCount > 0 && (
        <Badge className="bg-primary text-primary-foreground text-[10px] h-5 min-w-[20px] flex items-center justify-center px-1.5 shrink-0">
          {unreadCount > 99 ? "99+" : unreadCount}
        </Badge>
      )}
    </div>
  );
}
