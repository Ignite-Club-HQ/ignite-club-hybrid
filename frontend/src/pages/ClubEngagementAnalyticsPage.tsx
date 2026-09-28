import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Activity,
  Users,
  UserPlus,
  MessageSquare,
  Megaphone,
  CalendarCheck,
  Image as ImageIcon,
  Eye,
  Heart,
  MessageCircle,
  TrendingUp,
  TrendingDown,
  Filter,
  Calendar as CalendarIcon,
  Trophy,
  MousePointerClick,
  RefreshCcw,
  AlertTriangle,
} from "lucide-react";
import {
  format,
  subDays,
  startOfDay,
  endOfDay,
  differenceInDays,
  parseISO,
  startOfWeek,
} from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";
import { cn } from "@/lib/utils";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClubEngagementAnalytics } from "@/lab/fixtureDataLayer";
import { CommunicationEngagementSection } from "@/components/club/CommunicationEngagementSection";

const ALL_TEAMS = "__all__";
const RANGE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

type RangeBounds = { start: Date; end: Date };

function bucketByDay(rows: { created_at?: string | null; viewed_at?: string | null }[], start: Date, end: Date, dateKey: "created_at" | "viewed_at" = "created_at") {
  const days = differenceInDays(end, start) + 1;
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = format(subDays(end, days - 1 - i), "yyyy-MM-dd");
    buckets.set(d, 0);
  }
  for (const r of rows) {
    const ts = (r as any)[dateKey];
    if (!ts) continue;
    const key = format(parseISO(ts), "yyyy-MM-dd");
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return Array.from(buckets.entries()).map(([day, count]) => ({ day, count }));
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export default function ClubEngagementAnalyticsPage({
  mode = "club",
}: { mode?: "club" | "platform" } = {}) {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    const analytics = getLocalLabClubEngagementAnalytics("club-icp-001");
    return (
      <div className="container max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">Engagement Analytics</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Showing synthetic ICP lab engagement analytics. Live aggregation is not connected to an ICP analytics service yet.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{analytics.active_members_7d}</p><p className="text-xs text-muted-foreground">Active members (7d)</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{analytics.posts_7d}</p><p className="text-xs text-muted-foreground">Posts (7d)</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{analytics.reactions_7d}</p><p className="text-xs text-muted-foreground">Reactions (7d)</p></CardContent></Card>
        </div>
      </div>
    );
  }

  return <SupabaseClubEngagementAnalyticsPage mode={mode} />;
}

function SupabaseClubEngagementAnalyticsPage({
  mode = "club",
}: { mode?: "club" | "platform" } = {}) {
  const params = useParams<{ clubId: string }>();
  const clubId = mode === "platform" ? null : params.clubId ?? null;
  const isPlatform = mode === "platform";
  const { user } = useAuth();
  const navigate = useNavigate();

  const [days, setDays] = useState<number>(30);
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(ALL_TEAMS);
  const [adoptionGranularity, setAdoptionGranularity] = useState<"daily" | "weekly" | "monthly">("daily");

  const range: RangeBounds = useMemo(() => {
    if (customStart && customEnd) {
      return { start: startOfDay(customStart), end: endOfDay(customEnd) };
    }
    return { start: startOfDay(subDays(new Date(), days - 1)), end: endOfDay(new Date()) };
  }, [days, customStart, customEnd]);

  const rangeDays = differenceInDays(range.end, range.start) + 1;
  const prevRange: RangeBounds = useMemo(() => ({
    start: startOfDay(subDays(range.start, rangeDays)),
    end: endOfDay(subDays(range.end, rangeDays)),
  }), [range, rangeDays]);

  const queryReady = isPlatform || !!clubId;

  // Pro gating (skip for platform-wide admin view)
  const { hasPro, isLoading: proLoading } = useClubProAccess(clubId, { enabled: !isPlatform });

  // ---------- Access control ----------
  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ["club-engagement-access", user?.id, clubId, mode],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, club_id")
        .eq("user_id", user!.id);
      if (!data) return { isAdmin: false, isCompAdmin: false };
      const isAppAdmin = data.some((r) => r.role === "app_admin");
      if (isPlatform) {
        return { isAdmin: isAppAdmin, isCompAdmin: isAppAdmin };
      }
      const isClubAdmin = data.some((r) => r.role === "club_admin" && r.club_id === clubId);
      const isCommittee = data.some((r) => r.role === "committee_member" && r.club_id === clubId);
      const isCompAdmin = data.some((r) => r.role === "competition_admin");
      return { isAdmin: isAppAdmin || isClubAdmin || isCommittee, isCompAdmin: isAppAdmin || isCompAdmin };
    },
    enabled: !!user && queryReady,
  });

  const { data: club } = useQuery({
    queryKey: ["club-engagement-meta", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .eq("id", clubId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !isPlatform && !!clubId,
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["club-engagement-teams", clubId, isPlatform],
    queryFn: async () => {
      let q = supabase
        .from("teams")
        .select("id, name, is_archived")
        .eq("is_archived", false)
        .order("name")
        .limit(2000);
      if (!isPlatform) q = q.eq("club_id", clubId!);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  const scopedTeamIds = useMemo(() => {
    if (selectedTeamId !== ALL_TEAMS) return [selectedTeamId];
    return teams.map((t) => t.id);
  }, [teams, selectedTeamId]);

  // ---------- Section 1 + 2: Activity / active users (via SECURITY DEFINER RPC) ----------
  // Bypasses per-user RLS on user_activity_logs so club admins see club-wide activity.
  // Passing _club_id=null returns platform-wide aggregate (app_admin only).
  const { data: activityRows = [], isLoading: actLoading } = useQuery({
    queryKey: ["club-engagement-activity-rpc", clubId, mode, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("club_engagement_active_users", {
        _club_id: clubId as any,
        _start: range.start.toISOString(),
        _end: range.end.toISOString(),
      });
      if (error) throw error;
      return (data || []) as { day: string; user_id: string }[];
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  const { data: prevActivityRows = [] } = useQuery({
    queryKey: ["club-engagement-activity-prev-rpc", clubId, mode, prevRange.start.toISOString(), prevRange.end.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("club_engagement_active_users", {
        _club_id: clubId as any,
        _start: prevRange.start.toISOString(),
        _end: prevRange.end.toISOString(),
      });
      if (error) throw error;
      return (data || []) as { day: string; user_id: string }[];
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  // Always-on 30-day window so the "Active (7d)" and "Active (30d)" tiles
  // remain stable regardless of the user's selected time-range filter.
  const { data: fixed30Rows = [] } = useQuery({
    queryKey: ["club-engagement-activity-fixed30-rpc", clubId, mode],
    queryFn: async () => {
      const end = new Date();
      const start = subDays(end, 30);
      const { data, error } = await supabase.rpc("club_engagement_active_users", {
        _club_id: clubId as any,
        _start: start.toISOString(),
        _end: end.toISOString(),
      });
      if (error) throw error;
      return (data || []) as { day: string; user_id: string }[];
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  const activeMembers = useMemo(() => {
    const now = new Date();
    const d7Cutoff = format(subDays(now, 7), "yyyy-MM-dd");
    const d30Cutoff = format(subDays(now, 30), "yyyy-MM-dd");
    const s7 = new Set<string>();
    const s30 = new Set<string>();
    // d7/d30 use the fixed 30-day window so they don't shrink/grow with the filter.
    for (const r of fixed30Rows) {
      if (!r.user_id) continue;
      if (r.day >= d7Cutoff) s7.add(r.user_id);
      if (r.day >= d30Cutoff) s30.add(r.user_id);
    }
    // "Active in range" stays tied to the selected filter.
    const sRange = new Set<string>();
    for (const r of activityRows) {
      if (r.user_id) sRange.add(r.user_id);
    }
    const sPrev = new Set<string>();
    for (const r of prevActivityRows) if (r.user_id) sPrev.add(r.user_id);
    return { d7: s7.size, d30: s30.size, range: sRange.size, prev: sPrev.size };
  }, [fixed30Rows, activityRows, prevActivityRows]);

  // Adoption timeline: DAU / WAU / MAU (per day in range)
  const adoptionSeries = useMemo(() => {
    const days = differenceInDays(range.end, range.start) + 1;
    const dayKeys: string[] = [];
    for (let i = 0; i < days; i++) {
      dayKeys.push(format(subDays(range.end, days - 1 - i), "yyyy-MM-dd"));
    }

    const dayUsers = new Map<string, Set<string>>();
    for (const key of dayKeys) dayUsers.set(key, new Set());
    for (const r of activityRows) {
      if (!r.user_id || !r.day) continue;
      dayUsers.get(r.day)?.add(r.user_id);
    }

    const todayKey = format(new Date(), "yyyy-MM-dd");
    const result: { day: string; value: number }[] = [];

    for (let i = 0; i < dayKeys.length; i++) {
      const day = dayKeys[i];
      if (day >= todayKey) continue;

      let users: Set<string>;
      if (adoptionGranularity === "daily") {
        users = dayUsers.get(day) || new Set();
      } else {
        const windowSize = adoptionGranularity === "weekly" ? 7 : 30;
        users = new Set<string>();
        for (let j = Math.max(0, i - windowSize + 1); j <= i; j++) {
          const set = dayUsers.get(dayKeys[j]);
          if (set) {
            for (const uid of set) users.add(uid);
          }
        }
      }
      result.push({ day, value: users.size });
    }

    const firstNonZero = result.findIndex((d) => d.value > 0);
    return firstNonZero === -1 ? [] : result.slice(firstNonZero);
  }, [activityRows, range, adoptionGranularity]);

  // ---------- New members ----------
  // Defined as: pending_invites that were accepted within the date range
  // (team_memberships/club_players are not the source of truth for joins)
  const { data: newMembers = [] } = useQuery({
    queryKey: ["club-engagement-new-members", clubId, mode, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      let q = supabase
        .from("pending_invites")
        .select("id, invited_user_id, accepted_at, club_id")
        .not("accepted_at", "is", null)
        .gte("accepted_at", range.start.toISOString())
        .lte("accepted_at", range.end.toISOString())
        .limit(5000);
      if (!isPlatform) q = q.eq("club_id", clubId!);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  const { data: prevNewMembers = [] } = useQuery({
    queryKey: ["club-engagement-new-members-prev", clubId, mode, prevRange.start.toISOString(), prevRange.end.toISOString()],
    queryFn: async () => {
      let q = supabase
        .from("pending_invites")
        .select("id, accepted_at, club_id")
        .not("accepted_at", "is", null)
        .gte("accepted_at", prevRange.start.toISOString())
        .lte("accepted_at", prevRange.end.toISOString())
        .limit(5000);
      if (!isPlatform) q = q.eq("club_id", clubId!);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: queryReady && !!access?.isAdmin,
  });


  // ---------- Invites ----------
  const { data: inviteStats } = useQuery({
    queryKey: ["club-engagement-invites", clubId, mode, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      let q = supabase
        .from("pending_invites")
        .select("id, accepted_at, created_at, status")
        .gte("created_at", range.start.toISOString())
        .lte("created_at", range.end.toISOString())
        .limit(10000);
      if (!isPlatform) q = q.eq("club_id", clubId!);
      const { data, error } = await q;
      if (error) throw error;
      const total = (data || []).length;
      const accepted = (data || []).filter((i) => !!i.accepted_at).length;
      return { total, accepted, rate: total ? Math.round((accepted / total) * 100) : 0 };
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  // ---------- Club-wide totals (RPC) — bypasses 1000-row cap & RLS for club admins ----------
  const { data: totals, isLoading: totalsLoading, error: totalsError } = useQuery({
    queryKey: ["club-engagement-totals-rpc", clubId, mode, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("club_engagement_totals", {
        _club_id: clubId as any,
        _start: range.start.toISOString(),
        _end: range.end.toISOString(),
      });
      if (error) throw error;
      const row = (data && (data as any[])[0]) || {};
      return {
        clubMsgs: Number(row.club_msgs ?? 0),
        teamMsgs: Number(row.team_msgs ?? 0),
        reactions: Number(row.reactions ?? 0),
        broadcasts: Number(row.broadcasts ?? 0),
        events: Number(row.events ?? 0),
        rsvpsTotal: Number(row.rsvps_total ?? 0),
        rsvpsResponded: Number(row.rsvps_responded ?? 0),
        rsvpsGoing: Number(row.rsvps_going ?? 0),
        photosUploaded: Number(row.photos_uploaded ?? 0),
      };
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  // ---------- Message volume per day (RPC) ----------
  const { data: msgVolume = [], error: msgVolumeError } = useQuery({
    queryKey: ["club-engagement-msg-volume-rpc", clubId, mode, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("club_engagement_message_volume", {
        _club_id: clubId as any,
        _start: range.start.toISOString(),
        _end: range.end.toISOString(),
      });
      if (error) throw error;
      return (data || []) as { day: string; club_count: number; team_count: number }[];
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  const msgVolumeChart = useMemo(
    () => msgVolume.map((r) => ({ day: r.day, Club: Number(r.club_count || 0), "Team / group": Number(r.team_count || 0) })),
    [msgVolume]
  );

  // ---------- RSVP completion % per day (RPC) ----------
  const { data: rsvpSeries = [] } = useQuery({
    queryKey: ["club-engagement-rsvp-series", clubId, mode, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("club_engagement_rsvp_completion_series", {
        _club_id: clubId as any,
        _start: range.start.toISOString(),
        _end: range.end.toISOString(),
      });
      if (error) throw error;
      return (data || []) as { week: string; completion_pct: number | null; responded: number; expected: number }[];
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  const rsvpSeriesChart = useMemo(() => {
    const currentWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
    return rsvpSeries
      .filter((r) => r.week < currentWeekStart)
      .map((r) => ({
        week: r.week,
        pct: r.completion_pct == null ? null : Number(r.completion_pct),
        responded: Number(r.responded || 0),
        expected: Number(r.expected || 0),
      }));
  }, [rsvpSeries]);
  const rsvpSeriesHasData = rsvpSeriesChart.some((d) => d.pct != null);

  const clubMsgsCount = totals?.clubMsgs ?? 0;
  const teamMsgsCount = totals?.teamMsgs ?? 0;
  const reactionCount = totals?.reactions ?? 0;
  const broadcastsCount = totals?.broadcasts ?? 0;

  const rsvpStats = useMemo(() => {
    // `expected` = sum across events of each event team's eligible roster (children assigned + active adult players).
    // This is the proper denominator for completion / attendance — rsvps rows alone would give 100% by definition.
    const expected = totals?.rsvpsTotal ?? 0;
    const responded = totals?.rsvpsResponded ?? 0;
    const going = totals?.rsvpsGoing ?? 0;
    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    return {
      eventsCreated: totals?.events ?? 0,
      completionRate: expected ? clamp(Math.round((responded / expected) * 100)) : 0,
      attendanceRate: expected ? clamp(Math.round((going / expected) * 100)) : 0,
      pending: Math.max(0, expected - responded),
    };
  }, [totals]);

  // ---------- Media: photo uploads (use total) + per-photo engagement (capped sample) ----------
  const { data: photos = [] } = useQuery({
    queryKey: ["club-engagement-photos", clubId, mode, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      let q = supabase
        .from("photos")
        .select("id")
        .is("deleted_at", null)
        .gte("created_at", range.start.toISOString())
        .lte("created_at", range.end.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);
      if (!isPlatform) q = q.eq("club_id", clubId!);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  const { data: photoEngagement } = useQuery({
    queryKey: ["club-engagement-photo-engagement", photos.map((p) => p.id).slice(0, 300)],
    queryFn: async () => {
      const ids = photos.map((p) => p.id);
      if (ids.length === 0) return { views: 0, reactions: 0, comments: 0 };
      let views = 0, reactions = 0, comments = 0;
      const chunk = 100;
      for (let i = 0; i < ids.length; i += chunk) {
        const slice = ids.slice(i, i + chunk);
        const [v, r, c] = await Promise.all([
          supabase.from("photo_views").select("id", { count: "exact", head: true }).in("photo_id", slice),
          supabase.from("photo_reactions").select("id", { count: "exact", head: true }).in("photo_id", slice),
          supabase.from("photo_comments").select("id", { count: "exact", head: true }).in("photo_id", slice),
        ]);
        views += v.count || 0;
        reactions += r.count || 0;
        comments += c.count || 0;
      }
      return { views, reactions, comments };
    },
    enabled: !!access?.isAdmin && photos.length > 0,
  });

  // ---------- Sponsors ----------
  const { data: sponsorRows = [] } = useQuery({
    queryKey: ["club-engagement-sponsors", clubId, mode],
    queryFn: async () => {
      let q = supabase
        .from("sponsors")
        .select("id, name, club_id")
        .eq("is_active", true)
        .limit(2000);
      if (!isPlatform) q = q.eq("club_id", clubId!);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  const { data: sponsorAnalytics = [] } = useQuery({
    queryKey: ["club-engagement-sponsor-analytics", sponsorRows.map((s) => s.id), range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      if (sponsorRows.length === 0) return [];
      // Fetch counts per sponsor per event_type to avoid 1000-row cap on raw rows.
      const out: { sponsor_id: string; event_type: string; n: number }[] = [];
      for (const s of sponsorRows) {
        const [v, c] = await Promise.all([
          supabase.from("sponsor_analytics")
            .select("id", { count: "exact", head: true })
            .eq("sponsor_id", s.id)
            .eq("event_type", "view")
            .gte("created_at", range.start.toISOString())
            .lte("created_at", range.end.toISOString()),
          supabase.from("sponsor_analytics")
            .select("id", { count: "exact", head: true })
            .eq("sponsor_id", s.id)
            .eq("event_type", "click")
            .gte("created_at", range.start.toISOString())
            .lte("created_at", range.end.toISOString()),
        ]);
        out.push({ sponsor_id: s.id, event_type: "view", n: v.count || 0 });
        out.push({ sponsor_id: s.id, event_type: "click", n: c.count || 0 });
      }
      return out;
    },
    enabled: !!access?.isAdmin && sponsorRows.length > 0,
  });

  const sponsorStats = useMemo(() => {
    let impressions = 0, clicks = 0;
    const bySponsor = new Map<string, { impressions: number; clicks: number }>();
    for (const s of sponsorAnalytics) {
      const entry = bySponsor.get(s.sponsor_id) || { impressions: 0, clicks: 0 };
      if (s.event_type === "click") { clicks += s.n; entry.clicks += s.n; }
      else if (s.event_type === "view") { impressions += s.n; entry.impressions += s.n; }
      bySponsor.set(s.sponsor_id, entry);
    }
    const ctr = impressions ? Math.round((clicks / impressions) * 1000) / 10 : 0;
    const top = Array.from(bySponsor.entries())
      .map(([sponsorId, v]) => ({
        sponsorId,
        name: sponsorRows.find((s) => s.id === sponsorId)?.name || "Unknown",
        ...v,
        ctr: v.impressions ? Math.round((v.clicks / v.impressions) * 1000) / 10 : 0,
      }))
      .sort((a, b) => (b.clicks - a.clicks) || (b.impressions - a.impressions))
      .slice(0, 5);
    return { impressions, clicks, ctr, top };
  }, [sponsorAnalytics, sponsorRows]);

  // ---------- Benchmark metrics (Active%, DAU/WAU/MAU, Message Participation, Read Rates) ----------
  const { data: benchmarks, error: benchmarksError } = useQuery({
    queryKey: ["club-engagement-benchmarks", clubId, mode, range.start.toISOString(), range.end.toISOString(), prevRange.start.toISOString(), prevRange.end.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("club_engagement_benchmarks", {
        _club_id: clubId as any,
        _start: range.start.toISOString(),
        _end: range.end.toISOString(),
        _prev_start: prevRange.start.toISOString(),
        _prev_end: prevRange.end.toISOString(),
      });
      if (error) throw error;
      return data as Record<string, number>;
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  // ---------- Sponsor performance (unique reach + CTR per sponsor) ----------
  const { data: sponsorPerf = [] } = useQuery({
    queryKey: ["club-engagement-sponsor-perf", clubId, mode, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("club_engagement_sponsor_performance", {
        _club_id: clubId as any,
        _start: range.start.toISOString(),
        _end: range.end.toISOString(),
        _prev_start: prevRange.start.toISOString(),
        _prev_end: prevRange.end.toISOString(),
      });
      if (error) throw error;
      return (data || []) as Array<{
        sponsor_id: string; sponsor_name: string; unique_reach: number;
        views: number; clicks: number; ctr: number;
        prev_clicks: number; prev_views: number;
        raw_views: number; raw_clicks: number;
        tracking_started: string | null;
      }>;
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  // ---------- Club-wide distinct members reached (de-duped across sponsors) ----------
  const { data: totalUniqueReach = 0 } = useQuery({
    queryKey: ["club-engagement-total-unique-reach", clubId, mode, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("club_engagement_total_unique_reach", {
        _club_id: clubId as any,
        _start: range.start.toISOString(),
        _end: range.end.toISOString(),
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    enabled: queryReady && !!access?.isAdmin,
  });

  // ---------- In-app Ad Performance (house ads served to Free clubs) ----------
  // Aligns with sponsor metrics (views, clicks, CTR, unique reach) so the
  // platform admin can compare in-house ad performance vs. AdMob (which is
  // reported separately in the Google AdMob console).
  const { data: appAds = [] } = useQuery({
    queryKey: ["engagement-app-ads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ads")
        .select("id, name, headline, ad_type, is_active")
        .order("display_order", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        name: string | null;
        headline: string | null;
        ad_type: string | null;
        is_active: boolean;
      }>;
    },
    enabled: queryReady && !!access?.isAdmin && isPlatform,
  });

  const { data: appAdAnalyticsRaw = [] } = useQuery({
    queryKey: [
      "engagement-app-ad-analytics",
      range.start.toISOString(),
      range.end.toISOString(),
      isPlatform,
    ],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_analytics")
        .select("ad_id, event_type, context, user_id")
        .gte("created_at", range.start.toISOString())
        .lte("created_at", range.end.toISOString())
        .limit(50000);
      if (error) throw error;
      return (data || []) as Array<{
        ad_id: string;
        event_type: string;
        context: string | null;
        user_id: string | null;
      }>;
    },
    enabled: queryReady && !!access?.isAdmin && isPlatform,
  });

  const { data: prevAppAdAnalyticsRaw = [] } = useQuery({
    queryKey: [
      "engagement-app-ad-analytics-prev",
      prevRange.start.toISOString(),
      prevRange.end.toISOString(),
      isPlatform,
    ],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_analytics")
        .select("ad_id, event_type")
        .gte("created_at", prevRange.start.toISOString())
        .lte("created_at", prevRange.end.toISOString())
        .limit(50000);
      if (error) throw error;
      return (data || []) as Array<{ ad_id: string; event_type: string }>;
    },
    enabled: queryReady && !!access?.isAdmin && isPlatform,
  });

  const adStats = useMemo(() => {
    const byAd = new Map<
      string,
      { views: number; clicks: number; reach: Set<string> }
    >();
    const byContext = new Map<string, { views: number; clicks: number }>();
    const allReach = new Set<string>();
    let totalViews = 0;
    let totalClicks = 0;

    for (const r of appAdAnalyticsRaw) {
      const entry =
        byAd.get(r.ad_id) || { views: 0, clicks: 0, reach: new Set<string>() };
      if (r.event_type === "view") {
        entry.views += 1;
        totalViews += 1;
      } else if (r.event_type === "click") {
        entry.clicks += 1;
        totalClicks += 1;
      }
      if (r.user_id) {
        entry.reach.add(r.user_id);
        allReach.add(r.user_id);
      }
      byAd.set(r.ad_id, entry);

      const ctxKey = r.context || "unknown";
      const ctx = byContext.get(ctxKey) || { views: 0, clicks: 0 };
      if (r.event_type === "view") ctx.views += 1;
      else if (r.event_type === "click") ctx.clicks += 1;
      byContext.set(ctxKey, ctx);
    }

    const prevByAd = new Map<string, { views: number; clicks: number }>();
    let prevTotalViews = 0;
    let prevTotalClicks = 0;
    for (const r of prevAppAdAnalyticsRaw) {
      const entry = prevByAd.get(r.ad_id) || { views: 0, clicks: 0 };
      if (r.event_type === "view") {
        entry.views += 1;
        prevTotalViews += 1;
      } else if (r.event_type === "click") {
        entry.clicks += 1;
        prevTotalClicks += 1;
      }
      prevByAd.set(r.ad_id, entry);
    }

    const rows = Array.from(byAd.entries()).map(([adId, v]) => {
      const meta = appAds.find((a) => a.id === adId);
      const prev = prevByAd.get(adId) || { views: 0, clicks: 0 };
      return {
        ad_id: adId,
        name: meta?.headline || meta?.name || "Untitled ad",
        ad_type: meta?.ad_type || "banner",
        is_active: meta?.is_active ?? false,
        views: v.views,
        clicks: v.clicks,
        reach: v.reach.size,
        ctr: v.views ? Math.round((v.clicks / v.views) * 1000) / 10 : 0,
        prev_clicks: prev.clicks,
        prev_views: prev.views,
      };
    });
    rows.sort(
      (a, b) => b.clicks - a.clicks || b.views - a.views,
    );

    const contextBreakdown = Array.from(byContext.entries())
      .map(([context, v]) => ({
        context,
        views: v.views,
        clicks: v.clicks,
        ctr: v.views ? Math.round((v.clicks / v.views) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.views - a.views);

    return {
      rows,
      contextBreakdown,
      totalViews,
      totalClicks,
      totalReach: allReach.size,
      ctr: totalViews
        ? Math.round((totalClicks / totalViews) * 1000) / 10
        : 0,
      prevTotalViews,
      prevTotalClicks,
      activeAds: appAds.filter((a) => a.is_active).length,
    };
  }, [appAdAnalyticsRaw, prevAppAdAnalyticsRaw, appAds]);



  // ---------- Engagement score (composite 0-100) ----------
  const engagementScore = useMemo(() => {
    // weighted: active members (40), msg+react volume per active user (20),
    // rsvp completion (20), media activity (10), sponsor ctr (10)
    const totalMembers = teams.length ? Math.max(scopedTeamIds.length * 12, activeMembers.range) : Math.max(activeMembers.range, 1);
    const activeRatio = Math.min(activeMembers.d30 / Math.max(totalMembers, 1), 1);
    const msgPerUser = activeMembers.range
      ? Math.min((clubMsgsCount + teamMsgsCount + reactionCount) / activeMembers.range / 10, 1)
      : 0;
    const rsvp = (rsvpStats.completionRate || 0) / 100;
    const media = photos.length ? Math.min(((photoEngagement?.views || 0) + (photoEngagement?.reactions || 0)) / Math.max(photos.length * 5, 1), 1) : 0;
    const sponsor = Math.min(sponsorStats.ctr / 5, 1);
    const score = Math.round(activeRatio * 40 + msgPerUser * 20 + rsvp * 20 + media * 10 + sponsor * 10);
    return Math.max(0, Math.min(100, score));
  }, [teams.length, scopedTeamIds.length, activeMembers, clubMsgsCount, teamMsgsCount, reactionCount, rsvpStats.completionRate, photos.length, photoEngagement, sponsorStats.ctr]);

  // ---------- Competition (admins only) ----------
  const { data: competitions = [] } = useQuery({
    queryKey: ["club-engagement-competitions", clubId, mode],
    queryFn: async () => {
      if (isPlatform) {
        const { data } = await supabase
          .from("competitions")
          .select("id, name")
          .limit(500);
        return data || [];
      }
      // Active participation only: accepted entries from non-deleted teams.
      const { data: entries } = await supabase
        .from("competition_entries")
        .select("competition_id, team_id, teams!inner(club_id, deleted_at)")
        .eq("teams.club_id", clubId!)
        .eq("status", "accepted")
        .is("teams.deleted_at", null)
        .limit(500);
      const compIds = Array.from(new Set((entries || []).map((e: any) => e.competition_id).filter(Boolean)));
      if (compIds.length === 0) return [] as any[];
      const { data } = await supabase
        .from("competitions")
        .select("id, name")
        .in("id", compIds);
      return data || [];
    },
    enabled: queryReady && !!access?.isCompAdmin,
  });


  // ---------- UI ----------
  if (accessLoading || (!isPlatform && proLoading)) {
    return (
      <div className="py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!access?.isAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Engagement</h1>
        </div>
        <p className="text-muted-foreground text-center py-12">
          Access denied. Club admin or committee role required.
        </p>
      </div>
    );
  }

  if (!isPlatform && !hasPro) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Engagement</h1>
        </div>
        <ProFeatureLock
          title="Engagement Analytics is a Pro feature"
          featureLabel="Engagement Analytics"
          clubId={clubId}
        />
      </div>
    );
  }

  return (
    <div className="py-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold truncate">Engagement Analytics</h1>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            {isPlatform
              ? "All clubs • platform-wide engagement"
              : `${club?.name ?? "Club"} • how your members are participating`}
          </p>

        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Filters</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {RANGE_PRESETS.map((p) => (
              <Button
                key={p.days}
                size="sm"
                variant={!customStart && !customEnd && days === p.days ? "default" : "outline"}
                onClick={() => {
                  setCustomStart(null);
                  setCustomEnd(null);
                  setDays(p.days);
                }}
              >
                {p.label}
              </Button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant={customStart && customEnd ? "default" : "outline"}>
                  <CalendarIcon className="h-4 w-4 mr-1" />
                  {customStart && customEnd
                    ? `${format(customStart, "MMM d")} – ${format(customEnd, "MMM d")}`
                    : "Custom"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                <CalendarComponent
                  mode="range"
                  selected={{ from: customStart ?? undefined, to: customEnd ?? undefined }}
                  onSelect={(r) => {
                    setCustomStart(r?.from ?? null);
                    setCustomEnd(r?.to ?? null);
                  }}
                  className={cn("p-3 pointer-events-auto")}
                  numberOfMonths={1}
                />
              </PopoverContent>
            </Popover>
          </div>
          {!isPlatform && (
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TEAMS}>All teams ({teams.length})</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <p className="text-xs text-muted-foreground">
            {format(range.start, "MMM d")} – {format(range.end, "MMM d, yyyy")} · vs previous {rangeDays}d
          </p>
        </CardContent>
      </Card>

      {/* Section 1: Club Health Overview */}
      <SectionHeader icon={Activity} title="Club Health" description="Active participation in the last period" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Metric icon={Users} label="Active (7d)" value={activeMembers.d7} loading={actLoading} />
        <Metric icon={Users} label="Active (30d)" value={activeMembers.d30} loading={actLoading} />
        <Metric icon={UserPlus} label="New members" value={newMembers.length} delta={pctChange(newMembers.length, prevNewMembers.length)} />
        <Metric icon={MessageCircle} label="Invite acceptance" value={`${inviteStats?.rate ?? 0}%`} hint={`${inviteStats?.accepted ?? 0}/${inviteStats?.total ?? 0}`} />
        <Metric icon={TrendingUp} label="Active in range" value={activeMembers.range} delta={pctChange(activeMembers.range, activeMembers.prev)} loading={actLoading} />
        <ScoreCard score={engagementScore} />
      </div>

      {/* Benchmark: Active Member % */}
      <SectionHeader icon={Users} title="Active Member Rate" description="Members with any meaningful action in this period" />
      {benchmarksError ? <AnalyticsErrorCard /> : <ActiveMemberCard b={benchmarks} />}

      {/* Benchmark: DAU / WAU / MAU */}
      <SectionHeader icon={Activity} title="Engagement (DAU / WAU / MAU)" description="Industry-standard active-user metrics" />
      {benchmarksError ? <AnalyticsErrorCard /> : <EngagementBenchmarkCards b={benchmarks} />}

      {/* Benchmark: Message Participation */}
      <SectionHeader icon={MessageSquare} title="Message Participation" description="How members engage with chat" />
      {benchmarksError ? <AnalyticsErrorCard /> : <MessageParticipationCard b={benchmarks} />}

      {/* Benchmark: Read Rates */}
      <SectionHeader icon={Eye} title="Read Rates" description="Communication effectiveness — viewers within 7 days" />
      {benchmarksError ? <AnalyticsErrorCard /> : <ReadRatesGrid b={benchmarks} />}

      {/* Section 2: Member Adoption */}
      <SectionHeader
        icon={Users}
        title="Member Adoption"
        description={
          adoptionGranularity === "daily"
            ? "Daily active users over time"
            : adoptionGranularity === "weekly"
              ? "Weekly active users over time"
              : "Monthly active users over time"
        }
      />
      <Card>
        <CardContent className="pt-4">
          <Tabs value={adoptionGranularity} onValueChange={(v) => setAdoptionGranularity(v as typeof adoptionGranularity)} className="mb-3">
            <TabsList className="grid grid-cols-3 w-full max-w-xs">
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="weekly">Weekly</TabsTrigger>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
            </TabsList>
          </Tabs>
          {actLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : adoptionSeries.every((d) => d.value === 0) ? (
            <EmptyState label="No member activity logged in this period yet." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={adoptionSeries}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tickFormatter={(d) => format(parseISO(d), "M/d")} fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    name={
                      adoptionGranularity === "daily"
                        ? "Daily active"
                        : adoptionGranularity === "weekly"
                          ? "Weekly active"
                          : "Monthly active"
                    }
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <CommunicationEngagementSection
        clubMessages={clubMsgsCount}
        teamMessages={teamMsgsCount}
        reactions={reactionCount}
        broadcasts={broadcastsCount}
        isLoading={totalsLoading}
        hasError={!!(totalsError || msgVolumeError)}
        volume={msgVolumeChart}
      />

      {/* Section 4: RSVP & Attendance */}
      <SectionHeader icon={CalendarCheck} title="RSVP & Attendance" description="Game & training events in range" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric icon={CalendarCheck} label="Events" value={rsvpStats.eventsCreated} />
        <Metric icon={TrendingUp} label="RSVP completion" value={`${rsvpStats.completionRate}%`} />
        <Metric icon={Users} label="Going rate" value={`${rsvpStats.attendanceRate}%`} />
        <Metric icon={RefreshCcw} label="Pending RSVPs" value={rsvpStats.pending} />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">RSVP completion % over time</CardTitle>
        </CardHeader>
        <CardContent>
          {!rsvpSeriesHasData ? (
            <EmptyState label="No events with eligible rosters in this period." />
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rsvpSeriesChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="week" tickFormatter={(d) => `Wk ${format(parseISO(d), "M/d")}`} fontSize={11} />
                  <YAxis fontSize={11} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any, _name, props: any) => {
                      if (value == null) return ["—", "Completion"];
                      const { responded, expected } = props?.payload || {};
                      return [`${value}% (${responded}/${expected})`, "Completion"];
                    }}
                    labelFormatter={(d) => `Week of ${format(parseISO(d as string), "MMM d, yyyy")}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="pct"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name="Completion"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 5: Media Engagement */}
      <SectionHeader icon={ImageIcon} title="Media" description="Photo uploads & viewer engagement" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric icon={ImageIcon} label="Photos uploaded" value={totals?.photosUploaded ?? photos.length} />
        <Metric icon={Eye} label="Views" value={photoEngagement?.views ?? 0} />
        <Metric icon={Heart} label="Reactions" value={photoEngagement?.reactions ?? 0} />
        <Metric icon={MessageCircle} label="Comments" value={photoEngagement?.comments ?? 0} />
      </div>

      {/* Section 6: Sponsor Performance */}
      <SectionHeader icon={Trophy} title="Sponsor Performance" description="Unique reach, profile views, clicks and CTR" />
      <SponsorPerformanceBlock rows={sponsorPerf} totalSponsors={sponsorRows.length} totalUniqueReach={totalUniqueReach} />

      {/* Section 6b: In-app Ad Performance (platform-wide only — house ads served to Free clubs).
          AdMob-mediated impressions/revenue are reported separately in the Google AdMob console. */}
      {isPlatform && (
        <>
          <SectionHeader
            icon={Megaphone}
            title="Ad Performance (In-App)"
            description="House ads served to Free clubs. AdMob revenue is reported in the Google AdMob console."
          />
          <AdPerformanceBlock stats={adStats} />
        </>
      )}


      {/* Section 7: Retention */}
      <SectionHeader icon={RefreshCcw} title="Retention" description="Repeat activity within the selected period" />
      <RetentionBlock activityRows={activityRows} prevActivityRows={prevActivityRows} />

      {/* Section 8: Competition */}
      {access.isCompAdmin && (
        <>
          <SectionHeader icon={Trophy} title="Competition Engagement" description="For competition admins" />
          {competitions.length === 0 ? (
            <Card>
              <CardContent className="py-6">
                <EmptyState label="No competitions linked to this club's teams yet." />
              </CardContent>
            </Card>
          ) : (
            <CompetitionPanel competitions={competitions} range={range} />
          )}
        </>
      )}
    </div>
  );
}

// ---------- helpers ----------
const tooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

function mergeSeries(parts: { name: string; rows: { day: string; count: number }[] }[]) {
  const days = parts[0]?.rows.map((r) => r.day) || [];
  return days.map((day, i) => {
    const row: any = { day };
    for (const p of parts) row[p.name] = p.rows[i]?.count ?? 0;
    return row;
  });
}

function SectionHeader({ icon: Icon, title, description }: { icon: any; title: string; description?: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <Icon className="h-4 w-4 text-primary" />
      <div>
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  delta,
  hint,
  loading,
}: {
  icon: any;
  label: string;
  value: number | string;
  delta?: number | null;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
          <Icon className="h-3.5 w-3.5" />
          <span className="truncate">{label}</span>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-1" />
        ) : (
          <div className="mt-1 text-xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</div>
        )}
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
        {typeof delta === "number" && (
          <div className={cn("text-[11px] flex items-center gap-0.5 mt-0.5", delta > 0 ? "text-emerald-500" : delta < 0 ? "text-destructive" : "text-muted-foreground")}>
            {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
            {delta > 0 ? "+" : ""}{delta}% vs prev
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreCard({ score }: { score: number }) {
  const color = score >= 70 ? "text-emerald-500" : score >= 40 ? "text-amber-500" : "text-destructive";
  return (
    <Card className="col-span-2 md:col-span-1">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
          <Activity className="h-3.5 w-3.5" />
          Engagement score
        </div>
        <div className={cn("mt-1 text-2xl font-bold", color)}>{score}<span className="text-sm text-muted-foreground font-normal">/100</span></div>
        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className={cn("h-full", score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-destructive")} style={{ width: `${score}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center text-sm text-muted-foreground py-8">
      {label}
    </div>
  );
}

function AnalyticsErrorCard() {
  return (
    <Card className="border-destructive/50">
      <CardContent className="p-3 flex items-start gap-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Analytics could not load. Refresh this page to try again.</span>
      </CardContent>
    </Card>
  );
}

type ActivityUserDay = { day: string; user_id: string | null };

function RetentionBlock({ activityRows, prevActivityRows }: { activityRows: ActivityUserDay[]; prevActivityRows: ActivityUserDay[] }) {
  const activeDaysByUser = new Map<string, Set<string>>();
  for (const r of activityRows) {
    if (!r.user_id || !r.day) continue;
    if (!activeDaysByUser.has(r.user_id)) activeDaysByUser.set(r.user_id, new Set());
    activeDaysByUser.get(r.user_id)!.add(r.day);
  }

  const current = new Set(activeDaysByUser.keys());
  const prev = new Set(prevActivityRows.map((r) => r.user_id).filter(Boolean));
  let returning = 0;
  let singleDay = 0;
  activeDaysByUser.forEach((daysActive) => {
    if (daysActive.size >= 2) returning++;
    else singleDay++;
  });

  // Churn still needs a previous baseline; if none exists, show unavailable instead of a false zero.
  let churned = 0;
  prev.forEach((u) => { if (!current.has(u)) churned++; });
  const retentionRate = current.size ? Math.round((returning / current.size) * 100) : 0;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Metric icon={Users} label="Returning users" value={returning} hint="2+ active days" />
      <Metric icon={TrendingUp} label="Retention rate" value={`${retentionRate}%`} hint="of active users" />
      <Metric icon={TrendingDown} label="Churned" value={prev.size ? churned : "—"} hint={prev.size ? "vs previous period" : "No previous baseline"} />
      <Metric icon={UserPlus} label="One-day active" value={singleDay} hint="1 active day" />
    </div>
  );
}

function CompetitionPanel({ competitions, range }: { competitions: { id: string; name: string }[]; range: RangeBounds }) {
  const compIds = competitions.map((c) => c.id);
  const { data: stats } = useQuery({
    queryKey: ["competition-engagement", compIds, range.start.toISOString(), range.end.toISOString()],
    queryFn: async () => {
      const [matches, broadcasts, entries] = await Promise.all([
        supabase
          .from("competition_matches")
          .select("id, home_score, away_score", { count: "exact", head: false })
          .in("competition_id", compIds)
          .limit(2000),
        supabase
          .from("competition_broadcasts")
          .select("id, created_at", { count: "exact", head: false })
          .in("competition_id", compIds)
          .gte("created_at", range.start.toISOString())
          .lte("created_at", range.end.toISOString())
          .limit(1000),
        // "Active teams" must exclude withdrawn/declined entries and teams that
        // have been soft-deleted.
        supabase
          .from("competition_entries")
          .select("id, team_id, teams!inner(deleted_at)", { count: "exact", head: true })
          .in("competition_id", compIds)
          .eq("status", "accepted")
          .is("teams.deleted_at", null),
      ]);
      const totalMatches = matches.data?.length || 0;
      const completed = (matches.data || []).filter((m: any) => m.home_score !== null && m.away_score !== null).length;
      return {
        activeTeams: entries.count || 0,
        totalMatches,
        resultsEntered: completed,
        broadcasts: broadcasts.data?.length || 0,
      };
    },
  });
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Metric icon={Users} label="Active teams" value={stats?.activeTeams ?? 0} />
      <Metric icon={CalendarCheck} label="Fixtures" value={stats?.totalMatches ?? 0} />
      <Metric icon={Trophy} label="Results entered" value={stats?.resultsEntered ?? 0} />
      <Metric icon={Megaphone} label="Comp broadcasts" value={stats?.broadcasts ?? 0} />
    </div>
  );
}

// ===================== Benchmark sub-components =====================

type Benchmarks = Record<string, number> | undefined;

function pct(n: number, d: number): number {
  if (!d) return 0;
  return Math.max(0, Math.min(100, Math.round((n / d) * 100)));
}

function TrendBadge({ current, previous, suffix = "%" }: { current: number; previous: number; suffix?: string }) {
  const delta = pctChange(current, previous);
  if (delta === null) return <span className="text-[10px] text-muted-foreground">no baseline</span>;
  const positive = delta > 0;
  const negative = delta < 0;
  return (
    <span className={cn(
      "text-[11px] flex items-center gap-0.5",
      positive ? "text-emerald-500" : negative ? "text-destructive" : "text-muted-foreground"
    )}>
      {positive ? <TrendingUp className="h-3 w-3" /> : negative ? <TrendingDown className="h-3 w-3" /> : null}
      {positive ? "+" : ""}{delta}{suffix} vs prev
    </span>
  );
}

function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <span title={typeof children === "string" ? children : undefined} className="text-[10px] text-muted-foreground cursor-help">
      ⓘ
    </span>
  );
}

function ActiveMemberCard({ b }: { b: Benchmarks }) {
  if (!b) return <Skeleton className="h-24 w-full" />;
  const total = Number(b.total_members || 0);
  const active = Number(b.active_members || 0);
  const inactive = Number(b.inactive_members || 0);
  const rate = pct(active, total);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-4xl font-bold text-primary">{rate}%</div>
            <div className="text-xs text-muted-foreground">
              Active Member Rate <InfoTip>Members with any meaningful action (open, view, message, react, RSVP, upload)</InfoTip>
            </div>
          </div>
          <div className="text-right text-xs space-y-0.5">
            <div><span className="font-semibold text-foreground">{total.toLocaleString()}</span> total</div>
            <div className="text-emerald-500">{active.toLocaleString()} active</div>
            <div className="text-muted-foreground">{inactive.toLocaleString()} inactive</div>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden flex">
          <div className="h-full bg-primary" style={{ width: `${rate}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

function EngagementBenchmarkCards({ b }: { b: Benchmarks }) {
  if (!b) return <Skeleton className="h-24 w-full" />;
  const dau = Number(b.dau || 0);
  const wau = Number(b.wau || 0);
  const mau = Number(b.mau || 0);
  const stickiness = pct(wau, mau);
  const prevStickiness = pct(Number(b.prev_wau || 0), Number(b.prev_mau || 0));
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Metric icon={Activity} label="DAU" value={dau} hint="last 24h" />
      <Metric icon={Users} label="WAU" value={wau} hint="last 7d" />
      <Metric icon={Users} label="MAU" value={mau} hint="last 30d" />
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Weekly Engagement</span>
            <InfoTip>Percentage of monthly users who return weekly (WAU/MAU)</InfoTip>
          </div>
          <div className="mt-1 text-xl font-bold text-primary">{stickiness}%</div>
          <TrendBadge current={stickiness} previous={prevStickiness} />
        </CardContent>
      </Card>
    </div>
  );
}

function MessageParticipationCard({ b }: { b: Benchmarks }) {
  if (!b) return <Skeleton className="h-32 w-full" />;
  const total = Number(b.total_members || 0);
  const posted = Number(b.posters || 0);
  const reacted = Number(b.reactors_only || 0);
  const readOnly = Number(b.readers_only || 0);
  const inactive = Number(b.inactive_msg || 0);
  const participation = pct(posted, total);
  const segments = [
    { key: "Posted a message", val: posted, color: "bg-primary" },
    { key: "Reacted only", val: reacted, color: "bg-emerald-500" },
    { key: "Read only", val: readOnly, color: "bg-amber-500" },
    { key: "Inactive", val: inactive, color: "bg-muted-foreground/30" },
  ];
  const sum = Math.max(total, segments.reduce((a, s) => a + s.val, 0), 1);
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-3xl font-bold text-primary">{participation}%</div>
            <div className="text-xs text-muted-foreground">
              Message Participation Rate{" "}
              <InfoTip>
                Share of club members who sent at least one chat message in this period.
                The numbers below count <strong>members</strong> (not messages) out of {total.toLocaleString()} total.
              </InfoTip>
            </div>
          </div>
        </div>
        <div className="h-3 rounded-full bg-muted overflow-hidden flex">
          {segments.map((s) => (
            <div key={s.key} className={cn("h-full", s.color)} style={{ width: `${(s.val / sum) * 100}%` }} />
          ))}
        </div>
        <div className="text-[11px] text-muted-foreground -mt-1">
          Member breakdown (of {total.toLocaleString()} total members)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-sm", s.color)} />
              <span className="text-muted-foreground">{s.key}:</span>
              <span className="font-semibold text-foreground">{s.val.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReadRateTile({ title, viewed, possible, prevViewed, prevPossible, emptyLabel }: {
  title: string; viewed: number; possible: number;
  prevViewed: number; prevPossible: number; emptyLabel?: string;
}) {
  if (possible === 0 && emptyLabel) {
    return (
      <Card>
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground">{title}</div>
          <p className="text-xs text-muted-foreground mt-2">{emptyLabel}</p>
        </CardContent>
      </Card>
    );
  }
  const rate = pct(viewed, possible);
  const prevRate = pct(prevViewed, prevPossible);
  const notViewed = Math.max(possible - viewed, 0);
  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {title} <InfoTip>Percentage of members who viewed this communication within 7 days</InfoTip>
        </div>
        <div className="text-2xl font-bold text-primary">{rate}%</div>
        <div className="text-[11px] text-muted-foreground">
          {viewed.toLocaleString()} viewed · {notViewed.toLocaleString()} not viewed
        </div>
        <TrendBadge current={rate} previous={prevRate} />
      </CardContent>
    </Card>
  );
}

function ReadRatesGrid({ b }: { b: Benchmarks }) {
  if (!b) return <Skeleton className="h-24 w-full" />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <ReadRateTile
        title="Club Messages"
        viewed={Number(b.club_msg_reads || 0)}
        possible={Number(b.club_msg_possible || 0)}
        prevViewed={Number(b.prev_club_msg_reads || 0)}
        prevPossible={Number(b.prev_club_msg_possible || 0)}
        emptyLabel="No club messages in this period."
      />
      <ReadRateTile
        title="Team Messages"
        viewed={Number(b.team_msg_reads || 0)}
        possible={Number(b.team_msg_possible || 0)}
        prevViewed={Number(b.prev_team_msg_reads || 0)}
        prevPossible={Number(b.prev_team_msg_possible || 0)}
        emptyLabel="No team messages in this period."
      />
    </div>
  );
}

type SponsorPerfRow = {
  sponsor_id: string; sponsor_name: string; unique_reach: number;
  views: number; clicks: number; ctr: number;
  prev_clicks: number; prev_views: number;
  raw_views: number; raw_clicks: number;
  tracking_started: string | null;
};

function SponsorPerformanceBlock({ rows, totalSponsors, totalUniqueReach }: { rows: SponsorPerfRow[]; totalSponsors: number; totalUniqueReach: number }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-6">
          <EmptyState label={totalSponsors === 0 ? "No active sponsors yet." : "No sponsor activity in this period."} />
        </CardContent>
      </Card>
    );
  }
  const totalReach = totalUniqueReach;
  const totalClicks = rows.reduce((a, r) => a + r.clicks, 0);
  const totalViews = rows.reduce((a, r) => a + r.views, 0);
  const totalRawViews = rows.reduce((a, r) => a + (r.raw_views || 0), 0);
  const avgCtr = totalViews ? Math.round((totalClicks / totalViews) * 1000) / 10 : 0;
  const highestCtr = [...rows].sort((a, b) => b.ctr - a.ctr)[0];
  const mostViewed = [...rows].sort((a, b) => b.views - a.views)[0];
  const mostReach = [...rows].sort((a, b) => b.unique_reach - a.unique_reach)[0];
  const trackingStarted = rows.find((r) => r.tracking_started)?.tracking_started;
  const trackingDate = trackingStarted ? new Date(trackingStarted) : null;
  const hasLegacyGap = totalRawViews > totalViews;

  return (
    <div className="space-y-3">
      {trackingDate && (
        <div className="text-[11px] text-muted-foreground border border-border/60 bg-muted/30 rounded-md px-2.5 py-1.5 leading-snug">
          Member-level sponsor tracking started <span className="text-foreground font-medium">{trackingDate.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>.
          Reach, Views and CTR below count only identified members so the numbers are comparable.
          {hasLegacyGap && <> Earlier anonymous impressions ({totalRawViews.toLocaleString()}) are excluded.</>}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric icon={Users} label="Members Reached" value={totalReach} hint="unique identified members" />
        <Metric icon={TrendingUp} label="Avg Sponsor CTR" value={`${avgCtr}%`} />
        <Metric icon={MousePointerClick} label="Tracked Clicks" value={totalClicks} />
        <Metric icon={Trophy} label="Active Sponsors" value={totalSponsors} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <LeaderCard label="Highest CTR" sponsorName={highestCtr?.sponsor_name} value={`${highestCtr?.ctr ?? 0}%`} />
        <LeaderCard label="Most Viewed" sponsorName={mostViewed?.sponsor_name} value={`${mostViewed?.views ?? 0} views`} />
        <LeaderCard label="Largest Reach" sponsorName={mostReach?.sponsor_name} value={`${mostReach?.unique_reach ?? 0} members`} />
      </div>


      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Sponsor leaderboard</CardTitle>
          <CardDescription className="text-xs">Engagement quality, not raw impressions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.map((r) => {
            const delta = pctChange(r.clicks, r.prev_clicks);
            return (
              <div key={r.sponsor_id} className="border border-border rounded-md p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate">{r.sponsor_name}</span>
                  {delta !== null && (
                    <span className={cn(
                      "text-[10px] flex items-center gap-0.5 shrink-0",
                      delta > 0 ? "text-emerald-500" : delta < 0 ? "text-destructive" : "text-muted-foreground"
                    )}>
                      {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                      {delta > 0 ? "+" : ""}{delta}% clicks
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1 text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Reach</div>
                    <div className="font-semibold">{r.unique_reach.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Views</div>
                    <div className="font-semibold">{r.views.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Clicks</div>
                    <div className="font-semibold">{r.clicks.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">CTR</div>
                    <div className="font-semibold text-primary">{r.ctr}%</div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function LeaderCard({ label, sponsorName, value }: { label: string; sponsorName?: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Trophy className="h-3.5 w-3.5 text-amber-500" /> {label}
        </div>
        <div className="mt-1 text-sm font-semibold truncate">{sponsorName || "—"}</div>
        <div className="text-xs text-primary">{value}</div>
      </CardContent>
    </Card>
  );
}

type AdStats = {
  rows: Array<{
    ad_id: string;
    name: string;
    ad_type: string;
    is_active: boolean;
    views: number;
    clicks: number;
    reach: number;
    ctr: number;
    prev_clicks: number;
    prev_views: number;
  }>;
  contextBreakdown: Array<{ context: string; views: number; clicks: number; ctr: number }>;
  totalViews: number;
  totalClicks: number;
  totalReach: number;
  ctr: number;
  prevTotalViews: number;
  prevTotalClicks: number;
  activeAds: number;
};

function AdPerformanceBlock({ stats }: { stats: AdStats }) {
  if (stats.totalViews === 0 && stats.totalClicks === 0) {
    return (
      <Card>
        <CardContent className="py-6">
          <EmptyState
            label={
              stats.activeAds === 0
                ? "No active in-app ads configured."
                : "No in-app ad activity in this period."
            }
          />
        </CardContent>
      </Card>
    );
  }

  const clicksDelta = pctChange(stats.totalClicks, stats.prevTotalClicks);
  const viewsDelta = pctChange(stats.totalViews, stats.prevTotalViews);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric icon={Eye} label="Impressions" value={stats.totalViews} delta={viewsDelta} />
        <Metric icon={MousePointerClick} label="Clicks" value={stats.totalClicks} delta={clicksDelta} />
        <Metric icon={TrendingUp} label="CTR" value={`${stats.ctr}%`} />
        <Metric icon={Users} label="Unique Reach" value={stats.totalReach} hint="distinct signed-in users" />
      </div>

      {stats.contextBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By placement</CardTitle>
            <CardDescription className="text-xs">Where the ad was shown when the event fired</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {stats.contextBreakdown.map((c) => (
              <div key={c.context} className="grid grid-cols-4 gap-2 text-[11px] border-b border-border/50 pb-1.5 last:border-0 last:pb-0">
                <div className="font-medium text-sm col-span-1 truncate">{c.context.replace(/_/g, " ")}</div>
                <div><span className="text-muted-foreground">Views </span><span className="font-semibold">{c.views.toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">Clicks </span><span className="font-semibold">{c.clicks.toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">CTR </span><span className="font-semibold text-primary">{c.ctr}%</span></div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Ad leaderboard</CardTitle>
          <CardDescription className="text-xs">Per-ad views, clicks, CTR and reach</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {stats.rows.map((r) => {
            const delta = pctChange(r.clicks, r.prev_clicks);
            return (
              <div key={r.ad_id} className="border border-border rounded-md p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {r.ad_type}{!r.is_active && " · inactive"}
                    </div>
                  </div>
                  {delta !== null && (
                    <span className={cn(
                      "text-[10px] flex items-center gap-0.5 shrink-0",
                      delta > 0 ? "text-emerald-500" : delta < 0 ? "text-destructive" : "text-muted-foreground"
                    )}>
                      {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                      {delta > 0 ? "+" : ""}{delta}% clicks
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1 text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Reach</div>
                    <div className="font-semibold">{r.reach.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Views</div>
                    <div className="font-semibold">{r.views.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Clicks</div>
                    <div className="font-semibold">{r.clicks.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">CTR</div>
                    <div className="font-semibold text-primary">{r.ctr}%</div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
