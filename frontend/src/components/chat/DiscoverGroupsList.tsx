import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Briefcase,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  HandHeart,
  HelpCircle,
  Lock,
  Search,
  Shield,
  Sparkles,
  Trophy,
} from "lucide-react";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getGroupVisual } from "@/lib/groupIcon";

interface OpenGroup {
  id: string;
  name: string;
  category: string | null;
  club_id: string;
  club_name: string | null;
  member_count: number;
  join_policy: string;
  joined: boolean;
  /** True when the current user has already submitted a pending request. */
  requested: boolean;
  last_text: string | null;
  last_at: string | null;
}

interface DiscoverGroupsListProps {
  activeClubFilter?: string | null;
}

type CategoryKey =
  | "operations"
  | "volunteers"
  | "events"
  | "match day"
  | "admin"
  | "finance"
  | "other";

// Section-header meta for the user-set `chat_groups.category` enum. Icons
// here label the *section*, not individual rows — per-row icons come from
// the richer semantic resolver in `@/lib/groupIcon`.
const CATEGORY_META: Record<
  CategoryKey,
  { label: string; icon: typeof Briefcase }
> = {
  operations:  { label: "Operations",  icon: Briefcase },
  volunteers:  { label: "Volunteers",  icon: HandHeart },
  events:      { label: "Events",      icon: Calendar },
  "match day": { label: "Match Day",   icon: Trophy },
  admin:       { label: "Admin",       icon: Shield },
  finance:     { label: "Finance",     icon: Coins },
  other:       { label: "Other",       icon: Sparkles },
};

function categoryKey(raw: string | null | undefined): CategoryKey {
  const k = (raw ?? "").trim().toLowerCase();
  if (k in CATEGORY_META) return k as CategoryKey;
  return "other";
}


const FILTER_CHIPS: { key: "all" | CategoryKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "operations", label: "Operations" },
  { key: "volunteers", label: "Volunteers" },
  { key: "events", label: "Events" },
  { key: "match day", label: "Match Day" },
  { key: "admin", label: "Admin" },
];

/**
 * WhatsApp/Slack-style channel discovery for Operations & Volunteers chat
 * groups in the user's active club. Server-side RLS on `chat_groups` gates
 * which groups are surfaced; `join_open_chat_group` RPC handles the join.
 */
export default function DiscoverGroupsList({ activeClubFilter }: DiscoverGroupsListProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<(typeof FILTER_CHIPS)[number]["key"]>("all");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const { hasPro, isLoading: proLoading } = useClubProAccess(activeClubFilter ?? null);

  const { data: groups = [] } = useQuery({
    queryKey: ["discover-open-groups", user?.id, activeClubFilter ?? null],
    enabled: !!user?.id && (!activeClubFilter || hasPro),
    staleTime: 60_000,
    queryFn: async (): Promise<OpenGroup[]> => {
      let q = supabase
        .from("chat_groups")
        .select("id, name, category, club_id, join_policy, clubs:club_id(name)")
        .in("join_policy", ["open_to_club", "request_to_join"])
        .is("deleted_at", null)
        .not("club_id", "is", null)
        .is("team_id", null)
        .is("mini_league_id", null);
      if (activeClubFilter) q = q.eq("club_id", activeClubFilter);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const [{ data: mine }, { data: members }, { data: msgs }, { data: myReqs }] = await Promise.all([
        supabase
          .from("group_members")
          .select("group_id")
          .eq("user_id", user!.id)
          .in("group_id", ids),
        supabase
          .from("group_members")
          .select("group_id")
          .in("group_id", ids),
        supabase
          .from("group_messages")
          .select("group_id, text, image_url, created_at, is_system_message")
          .in("group_id", ids)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("chat_group_join_requests" as any)
          .select("group_id")
          .eq("user_id", user!.id)
          .eq("status", "pending")
          .in("group_id", ids),
      ]);
      const joined = new Set((mine ?? []).map((m: any) => m.group_id));
      const requested = new Set((myReqs ?? []).map((m: any) => m.group_id));
      const counts = new Map<string, number>();
      (members ?? []).forEach((m: any) => {
        counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);
      });
      const lastByGroup = new Map<string, { text: string | null; at: string }>();
      (msgs ?? []).forEach((m: any) => {
        if (m.is_system_message) return;
        if (lastByGroup.has(m.group_id)) return;
        const text = m.text?.trim() || (m.image_url ? "📷 Photo" : null);
        lastByGroup.set(m.group_id, { text, at: m.created_at });
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category ?? null,
        club_id: r.club_id,
        club_name: (r.clubs && (Array.isArray(r.clubs) ? r.clubs[0]?.name : r.clubs.name)) ?? null,
        join_policy: r.join_policy ?? "request_to_join",
        member_count: counts.get(r.id) ?? 0,
        joined: joined.has(r.id),
        requested: requested.has(r.id),
        last_text: lastByGroup.get(r.id)?.text ?? null,
        last_at: lastByGroup.get(r.id)?.at ?? null,
      }));
    },
  });

  const requestMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { data, error } = await (supabase as any).rpc("request_join_chat_group", {
        _group_id: groupId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Request sent — a current member must approve");
      queryClient.invalidateQueries({ queryKey: ["discover-open-groups"] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Could not send request");
    },
    onSettled: () => setJoiningId(null),
  });

  const joinMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { data, error } = await (supabase as any).rpc("join_open_chat_group", {
        _group_id: groupId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("You've joined the group");
      queryClient.invalidateQueries({ queryKey: ["discover-open-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Could not join group");
    },
    onSettled: () => setJoiningId(null),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (chip !== "all" && categoryKey(g.category) !== chip) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        (g.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [groups, search, chip]);

  // Group filtered list by category for scalability
  const grouped = useMemo(() => {
    const map = new Map<CategoryKey, OpenGroup[]>();
    for (const g of filtered) {
      const k = categoryKey(g.category);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(g);
    }
    // Stable order
    const order: CategoryKey[] = ["operations", "volunteers", "events", "match day", "admin", "finance", "other"];
    return order
      .filter((k) => map.has(k))
      .map((k) => ({ key: k, meta: CATEGORY_META[k], items: map.get(k)! }));
  }, [filtered]);

  const joinableCount = groups.filter((g) => !g.joined).length;
  const showCategories = groups.length >= 6;

  const toggleCat = (k: string) => {
    setCollapsedCats((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const renderRow = (g: OpenGroup) => {
    const { Icon, tone } = getGroupVisual(g.name, g.category);
    const active = g.last_at
      ? Date.now() - new Date(g.last_at).getTime() < 1000 * 60 * 60 * 24
      : false;
    const memberLine =
      g.member_count === 0
        ? "Needs volunteers — be the first to join"
        : `${g.member_count} ${g.member_count === 1 ? "member" : "members"}`;
    const subtitle = g.last_text || memberLine;

    return (
      <button
        key={g.id}
        type="button"
        onClick={() => g.joined && navigate(`/groups/${g.id}`)}
        className={cn(
          "group w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left transition-all",
          "active:scale-[0.99] hover:bg-muted/60",
        )}
      >
        <div
          className={cn(
            "relative h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
            tone,
          )}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          {!g.joined && active && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
          )}
        </div>


        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold truncate text-foreground">
              {g.name}
            </p>
            {active && !g.joined && (
              <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                Active today
              </span>
            )}
          </div>
          {g.club_name && (
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 truncate leading-tight">
              {g.club_name}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground/80 truncate leading-tight">
            {subtitle}
          </p>
        </div>

        {g.joined ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            <Check className="h-3 w-3" strokeWidth={3} />
            Joined
          </span>
        ) : g.requested ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            Pending
          </span>
        ) : (
          <Button
            size="sm"
            variant="default"
            className="h-7 px-3 text-xs font-semibold shrink-0 rounded-full"
            disabled={joiningId === g.id}
            onClick={(e) => {
              e.stopPropagation();
              setJoiningId(g.id);
              if (g.join_policy === "open_to_club") joinMutation.mutate(g.id);
              else requestMutation.mutate(g.id);
            }}
          >
            {joiningId === g.id ? "…" : g.join_policy === "open_to_club" ? "Join" : "Request"}
          </Button>
        )}
      </button>
    );
  };


  // Pro-gate: Discover (Operations / Volunteers) groups are a Pro club feature.
  // When the active club is not Pro, render a locked CTA that routes to upgrade.
  if (activeClubFilter && !proLoading && !hasPro) {
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={() => navigate(`/clubs/${activeClubFilter}/upgrade`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate(`/clubs/${activeClubFilter}/upgrade`);
          }
        }}
        className="border-dashed shadow-none cursor-pointer hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-3 px-3 py-3">
          <div className="p-1.5 rounded-full bg-primary/10 shrink-0">
            <Lock className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-tight flex items-center gap-1.5">
              Discover groups
              <span className="text-[10px] uppercase tracking-wide font-semibold text-primary">Pro</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
              Operations &amp; Volunteers groups are a Pro feature. Tap to upgrade and unlock club-wide open groups.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-dashed shadow-none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">Discover groups</span>
          {joinableCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] shrink-0">
              {joinableCount} new
            </Badge>
          )}
          <Popover>
            <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                aria-label="How discover works"
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72 text-xs leading-relaxed"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-medium text-sm mb-1">How this works</p>
              <p className="text-muted-foreground">
                Admins can mark <strong>Operations</strong> or <strong>Volunteers</strong> groups
                as open to the club. Groups set to <strong>Join</strong> let you in straight away;
                groups set to <strong>Request</strong> need an existing member to approve you first.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-2 py-3">
              No open groups yet. Ask a club admin to open an Operations or Volunteers group to the club.
            </p>
          ) : (
            <>
              {groups.length > 4 && (
                <div className="space-y-2 px-1">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search groups…"
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
                    {FILTER_CHIPS.map((c) => {
                      const has = c.key === "all" || groups.some((g) => categoryKey(g.category) === c.key);
                      if (!has) return null;
                      const active = chip === c.key;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => setChip(c.key)}
                          className={cn(
                            "shrink-0 h-6 px-2.5 rounded-full text-[11px] font-medium border transition-colors",
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border hover:text-foreground",
                          )}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-2 py-3">
                  No groups match your filters.
                </p>
              ) : showCategories ? (
                <div className="space-y-3 pt-1">
                  {grouped.map(({ key, meta, items }) => {
                    const collapsed = collapsedCats.has(key);
                    const joinable = items.filter((i) => !i.joined).length;
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          onClick={() => toggleCat(key)}
                          className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/90 hover:text-foreground transition-colors"
                        >
                          {collapsed ? (
                            <ChevronRight className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                          <span>{meta.label}</span>
                          <span className="text-muted-foreground/50 font-normal normal-case tracking-normal">
                            · {items.length}
                          </span>
                          {joinable > 0 && (
                            <span className="ml-auto normal-case tracking-normal text-[10px] font-medium text-primary">
                              {joinable} to join
                            </span>
                          )}
                        </button>
                        {!collapsed && (
                          <div className="space-y-0.5 mt-0.5 animate-in fade-in-0 slide-in-from-top-1 duration-150">
                            {items.map(renderRow)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-0.5">{filtered.map(renderRow)}</div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
