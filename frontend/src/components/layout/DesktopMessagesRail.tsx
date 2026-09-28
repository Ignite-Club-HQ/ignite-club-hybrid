import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { formatDistanceToNow } from "date-fns";
import { Search, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getMessagePreviewText } from "@/lib/messagePreview";

interface RailItem {
  id: string;
  kind: "dm" | "group" | "team" | "club";
  title: string;
  avatarUrl: string | null;
  snippet: string;
  activityAt: string;
  route: string;
  /** Club that owns this chat (null for personal groups / DMs) */
  clubId?: string | null;
  /** Team that owns this chat (null for club-level or personal groups) */
  teamId?: string | null;
  /** Other participant (DMs) or members (personal groups) for club scoping */
  otherUserIds?: string[];
}


/**
 * Desktop-only right rail (xl+) listing recent conversations with last-message
 * snippets. Read-only and navigation-only: tapping a row opens the full
 * existing chat route, and "View all messages" goes to the full inbox. Data
 * comes from the same security-definer inbox RPCs MessagesPage uses, so RLS
 * and visibility rules match the real inbox.
 */
export function DesktopMessagesRail() {
  const { user, initialized } = useAuth();
  const { activeClubFilter, activeClubTeamIds } = useClubTheme();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const isNative = Capacitor.isNativePlatform();


  // DM conversations (same base query + latest-message RPC as MessagesPage)
  const { data: dmItems = [] } = useQuery({
    queryKey: ["desktop-rail-dms", user?.id],
    enabled: !!user && initialized && !isNative,
    staleTime: 30_000,
    refetchOnReconnect: "always",
    queryFn: async (): Promise<RailItem[]> => {
      const { data: convos, error } = await supabase
        .from("direct_conversations")
        .select("*")
        .or(`participant_1.eq.${user!.id},participant_2.eq.${user!.id}`)
        .order("updated_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      if (!convos?.length) return [];

      const otherIds = convos.map((c) =>
        c.participant_1 === user!.id ? c.participant_2 : c.participant_1
      );
      const [profilesRes, latestRes] = await Promise.all([
        selectCachedProfilesByIds(otherIds).catch(() => null),
        supabase.rpc("get_inbox_latest_dm_messages", {
          _conversation_ids: convos.map((c) => c.id),
        }),
      ]);
      const profileMap = new Map(
        ((profilesRes as any[]) || []).map((p: any) => [p.id, p])
      );
      const latestMap = new Map<string, any>(
        ((latestRes.data as any[]) || []).map((r: any) => [r.conversation_id, r])
      );

      return convos.map((c) => {
        const otherId =
          c.participant_1 === user!.id ? c.participant_2 : c.participant_1;
        const other: any = profileMap.get(otherId);
        const last = latestMap.get(c.id);
        const snippet = last
          ? `${last.author_id === user!.id ? "You" : other?.display_name || ""}: ${
              getMessagePreviewText(last.text, last.image_url) || "📷 Photo"
            }`
          : "No messages yet";
        return {
          id: c.id,
          kind: "dm" as const,
          title: other?.display_name || "Unknown User",
          avatarUrl: other?.avatar_url ?? null,
          snippet,
          activityAt: last?.created_at || c.updated_at,
          route: `/messages/dm/${c.id}`,
          clubId: null,
          teamId: null,
          otherUserIds: otherId ? [otherId] : [],
        };
      });

    },
  });

  // Group chats (club/team/custom) via the same access RPC the inbox uses
  const { data: groupItems = [] } = useQuery({
    queryKey: ["desktop-rail-groups", user?.id],
    enabled: !!user && initialized && !isNative,
    staleTime: 30_000,
    refetchOnReconnect: "always",
    queryFn: async (): Promise<RailItem[]> => {
      const { data: ids, error: idsErr } = await (supabase as any).rpc(
        "get_my_accessible_chat_group_ids",
        { _user_id: user!.id }
      );
      if (idsErr || !Array.isArray(ids) || ids.length === 0) return [];

      const { data: groups, error } = await supabase
        .from("chat_groups")
        .select("id, name, created_at, club_id, team_id, teams(name, deleted_at), clubs!club_id(name, deleted_at, purged_at)")
        .in("id", ids as string[])
        .is("deleted_at", null);
      if (error) throw error;


      const visible = ((groups || []) as any[]).filter(
        (g) => !g.teams?.deleted_at && !g.clubs?.deleted_at && !g.clubs?.purged_at
      );
      if (visible.length === 0) return [];

      let latestMap = new Map<string, any>();
      try {
        const { data: rows } = await (supabase as any).rpc(
          "get_inbox_latest_group_messages",
          { _group_ids: visible.map((g: any) => g.id) }
        );
        latestMap = new Map(((rows as any[]) || []).map((r: any) => [r.group_id, r]));
      } catch {
        // Snippets are best-effort in the rail.
      }

      // Personal groups (no club/team) are scoped by their members' club roles.
      const personalIds = visible
        .filter((g: any) => !g.club_id && !g.team_id)
        .map((g: any) => g.id);
      const membersByGroup = new Map<string, string[]>();
      if (personalIds.length > 0) {
        const { data: members } = await supabase
          .from("group_members")
          .select("group_id, user_id")
          .in("group_id", personalIds);
        ((members as any[]) || []).forEach((m: any) => {
          if (!m.user_id || m.user_id === user!.id) return;
          const list = membersByGroup.get(m.group_id) || [];
          list.push(m.user_id);
          membersByGroup.set(m.group_id, list);
        });
      }

      return visible.map((g: any) => {
        const last = latestMap.get(g.id);
        const contextName = g.teams?.name || g.clubs?.name || null;
        const snippet = last
          ? `${last.author_display_name ? last.author_display_name + ": " : ""}${
              getMessagePreviewText(last.text, last.image_url) || "📷 Photo"
            }`
          : contextName || "No messages yet";
        return {
          id: g.id,
          kind: "group" as const,
          title: g.name || contextName || "Group chat",
          avatarUrl: null,
          snippet,
          activityAt: last?.created_at || g.created_at,
          route: `/groups/${g.id}`,
          clubId: g.club_id ?? null,
          teamId: g.team_id ?? null,
          otherUserIds: membersByGroup.get(g.id) || [],
        };
      });
    },
  });

  // Team chats — same source as the inbox "Teams" section.
  const { data: teamItems = [] } = useQuery({
    queryKey: ["desktop-rail-teams", user?.id],
    enabled: !!user && initialized && !isNative,
    staleTime: 30_000,
    refetchOnReconnect: "always",
    queryFn: async (): Promise<RailItem[]> => {
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .not("team_id", "is", null);
      if (rolesErr) throw rolesErr;
      const teamIds = [...new Set((roles || []).map((r: any) => r.team_id).filter(Boolean))];
      if (teamIds.length === 0) return [];

      const { data: teams, error } = await supabase
        .from("teams")
        .select("id, name, logo_url, club_id, created_at, clubs!club_id(name, logo_url, deleted_at, purged_at)")
        .in("id", teamIds as string[])
        .is("deleted_at", null);
      if (error) throw error;
      const visible = ((teams || []) as any[]).filter(
        (t) => !t.clubs?.deleted_at && !t.clubs?.purged_at
      );
      if (visible.length === 0) return [];

      let latestMap = new Map<string, any>();
      try {
        const { data: rows } = await (supabase as any).rpc("get_inbox_latest_team_messages", {
          _team_ids: visible.map((t: any) => t.id),
        });
        latestMap = new Map(((rows as any[]) || []).map((r: any) => [r.team_id, r]));
      } catch {
        // Snippets are best-effort in the rail.
      }

      return visible.map((t: any) => {
        const last = latestMap.get(t.id);
        const isAnnouncement = !!(last?.is_club_announcement && last?.club_announcement_name);
        const author = isAnnouncement ? last.club_announcement_name : last?.author_display_name;
        const snippet = last
          ? `${author ? author + ": " : ""}${getMessagePreviewText(last.text, last.image_url) || "📷 Photo"}`
          : "No messages yet";
        return {
          id: t.id,
          kind: "team" as const,
          title: t.name || "Team chat",
          avatarUrl: t.logo_url || t.clubs?.logo_url || null,
          snippet,
          activityAt: last?.created_at || t.created_at,
          route: `/messages/${t.id}`,
          clubId: t.club_id ?? null,
          teamId: t.id,
        };
      });
    },
  });

  // Club chats — same source as the inbox "Clubs" section.
  const { data: clubItems = [] } = useQuery({
    queryKey: ["desktop-rail-clubs", user?.id],
    enabled: !!user && initialized && !isNative,
    staleTime: 30_000,
    refetchOnReconnect: "always",
    queryFn: async (): Promise<RailItem[]> => {
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);
      if (rolesErr) throw rolesErr;
      const clubIds = [...new Set((roles || []).map((r: any) => r.club_id).filter(Boolean))];
      if (clubIds.length === 0) return [];

      const { data: clubs, error } = await supabase
        .from("clubs")
        .select("id, name, logo_url, created_at")
        .in("id", clubIds as string[])
        .is("deleted_at", null)
        .neq("kind", "shell");
      if (error) throw error;
      const visible = (clubs || []) as any[];
      if (visible.length === 0) return [];

      let latestMap = new Map<string, any>();
      try {
        const { data: rows } = await (supabase as any).rpc("get_inbox_latest_club_messages", {
          _club_ids: visible.map((c: any) => c.id),
        });
        latestMap = new Map(((rows as any[]) || []).map((r: any) => [r.club_id, r]));
      } catch {
        // Snippets are best-effort in the rail.
      }

      return visible.map((c: any) => {
        const last = latestMap.get(c.id);
        const snippet = last
          ? `${last.author_display_name ? last.author_display_name + ": " : ""}${
              getMessagePreviewText(last.text, last.image_url) || "📷 Photo"
            }`
          : "No messages yet";
        return {
          id: c.id,
          kind: "club" as const,
          title: c.name || "Club chat",
          avatarUrl: c.logo_url ?? null,
          snippet,
          activityAt: last?.created_at || c.created_at,
          route: `/messages/club/${c.id}`,
          clubId: c.id,
          teamId: null,
        };
      });
    },
  });



  // Which of the people we share DMs / personal groups with belong to the
  // active club. Mirrors MessagesPage's club-scope filter so the rail shows the
  // same set of conversations as the full inbox.
  const scopeCandidateIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of [...dmItems, ...groupItems]) {
      if (item.clubId || item.teamId) continue;
      (item.otherUserIds || []).forEach((id) => set.add(id));
    }
    return Array.from(set).sort();
  }, [dmItems, groupItems]);

  const { data: usersInActiveClub } = useQuery({
    queryKey: ["desktop-rail-club-scope", activeClubFilter, scopeCandidateIds],
    enabled:
      !!user && initialized && !isNative && !!activeClubFilter && scopeCandidateIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", activeClubFilter!)
        .in("user_id", scopeCandidateIds);
      return new Set(((data as any[]) || []).map((r: any) => r.user_id).filter(Boolean));
    },
  });

  const items = useMemo(() => {
    let combined = [...dmItems, ...groupItems, ...teamItems, ...clubItems].sort(
      (a, b) => new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime()
    );

    if (activeClubFilter) {
      combined = combined.filter((i) => {
        if (i.clubId) return i.clubId === activeClubFilter;
        if (i.teamId) return activeClubTeamIds.includes(i.teamId);
        // DMs and personal groups: keep when a counterpart is in the active club.
        const others = i.otherUserIds || [];
        if (others.length === 0) return true;
        if (!usersInActiveClub) return true; // fail open while scoping resolves
        return others.some((uid) => usersInActiveClub.has(uid));
      });
    }

    const q = query.trim().toLowerCase();
    const filtered = q
      ? combined.filter(
          (i) =>
            i.title.toLowerCase().includes(q) || i.snippet.toLowerCase().includes(q)
        )
      : combined;
    return filtered.slice(0, 8);
  }, [dmItems, groupItems, teamItems, clubItems, query, activeClubFilter, activeClubTeamIds, usersInActiveClub]);


  if (isNative) return null;

  return (
    <section
      className="hidden xl:flex fixed right-0 top-0 bottom-0 z-40 w-80 flex-col border-l border-border bg-card"
      aria-label="Recent messages"
    >
      <div className="p-5 border-b border-border">
        <h2 className="text-lg font-bold text-foreground">Messages</h2>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats..."
            aria-label="Search chats"
            className="w-full bg-muted border-none rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            {query ? "No chats match your search." : "No conversations yet."}
          </p>
        )}
        {items.map((item) => (
          <button
            key={`${item.kind}-${item.id}`}
            onClick={() => navigate(item.route)}
            className={cn(
              "w-full text-left p-4 border-b border-border/50 hover:bg-muted/60 transition-colors cursor-pointer"
            )}
          >
            <div className="flex gap-3">
              {item.kind === "dm" ? (
                <Avatar className="w-10 h-10 shrink-0">
                  <AvatarImage src={item.avatarUrl || undefined} alt={item.title} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {item.title.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <div className="w-10 h-10 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Users className="h-4 w-4" aria-hidden="true" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="font-bold text-sm text-foreground truncate">
                    {item.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-medium shrink-0">
                    {formatDistanceToNow(new Date(item.activityAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {item.snippet}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="p-4 bg-card border-t border-border">
        <button
          onClick={() => navigate("/messages")}
          className="w-full py-2 bg-muted text-primary rounded-lg text-sm font-bold border border-border hover:bg-muted/70 transition-colors cursor-pointer"
        >
          View All Messages
        </button>
      </div>
    </section>
  );
}
