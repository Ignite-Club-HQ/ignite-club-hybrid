import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfDay } from "date-fns";
import { BarChart3, Clock, LogIn, Users, Search, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";

type TimePeriod = "7d" | "14d" | "30d" | "90d";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

export default function UserAnalyticsTab() {
  const [period, setPeriod] = useState<TimePeriod>("7d");
  const [search, setSearch] = useState("");
  const [clubFilter, setClubFilter] = useState<string>("all");

  const periodDays = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 }[period];
  const startDate = startOfDay(subDays(new Date(), periodDays));

  // Fetch clubs for filter
  const { data: clubs } = useQuery({
    queryKey: ["admin-clubs-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("id, name")
        .order("name");
      return data || [];
    },
  });

  // Fetch activity data
  const { data: activityData, isLoading } = useQuery({
    queryKey: ["admin-user-analytics", period, clubFilter],
    queryFn: async () => {
      let query = supabase
        .from("user_activity_logs" as any)
        .select("user_id, page_path, page_label, session_id, started_at, duration_seconds, club_id")
        .gte("started_at", startDate.toISOString())
        .order("started_at", { ascending: false });

      if (clubFilter !== "all") {
        query = query.eq("club_id", clubFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  // Fetch profiles for all users in the activity data
  const userIds = useMemo(
    () => [...new Set((activityData || []).map((a: any) => a.user_id))],
    [activityData]
  );

  const { data: profiles } = useQuery({
    queryKey: ["admin-activity-profiles", userIds],
    queryFn: async () => {
      if (userIds.length === 0) return {};
      const { data } = await selectCachedProfilesByIds(userIds);
      const map: Record<string, { display_name: string; avatar_url: string | null }> = {};
      data?.forEach((p) => {
        map[p.id] = { display_name: p.display_name || "Unknown", avatar_url: p.avatar_url };
      });
      return map;
    },
    enabled: userIds.length > 0,
  });

  // Aggregate per-user stats
  const userStats = useMemo(() => {
    if (!activityData || !profiles) return [];

    const statsMap: Record<string, {
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      totalSeconds: number;
      sessionCount: number;
      pageViews: number;
      lastActive: string;
      topPages: Record<string, number>;
    }> = {};

    for (const log of activityData as any[]) {
      if (!statsMap[log.user_id]) {
        const profile = profiles[log.user_id];
        statsMap[log.user_id] = {
          userId: log.user_id,
          displayName: profile?.display_name || "Unknown User",
          avatarUrl: profile?.avatar_url || null,
          totalSeconds: 0,
          sessionCount: 0,
          pageViews: 0,
          lastActive: log.started_at,
          topPages: {},
        };
      }

      const stat = statsMap[log.user_id];
      stat.totalSeconds += log.duration_seconds || 0;
      stat.pageViews += 1;

      const label = log.page_label || log.page_path;
      stat.topPages[label] = (stat.topPages[label] || 0) + 1;

      if (log.started_at > stat.lastActive) {
        stat.lastActive = log.started_at;
      }
    }

    // Count unique sessions per user
    const sessionsByUser: Record<string, Set<string>> = {};
    for (const log of activityData as any[]) {
      if (!sessionsByUser[log.user_id]) sessionsByUser[log.user_id] = new Set();
      sessionsByUser[log.user_id].add(log.session_id);
    }
    for (const [uid, sessions] of Object.entries(sessionsByUser)) {
      if (statsMap[uid]) statsMap[uid].sessionCount = sessions.size;
    }

    return Object.values(statsMap).sort((a, b) => b.totalSeconds - a.totalSeconds);
  }, [activityData, profiles]);

  // Apply search filter
  const filteredStats = useMemo(() => {
    if (!search.trim()) return userStats;
    const q = search.toLowerCase();
    return userStats.filter((s) => s.displayName.toLowerCase().includes(q));
  }, [userStats, search]);

  // Summary stats
  const totalUsers = userStats.length;
  const totalSessions = userStats.reduce((sum, s) => sum + s.sessionCount, 0);
  const totalScreenTime = userStats.reduce((sum, s) => sum + s.totalSeconds, 0);
  const avgSessionTime = totalSessions > 0 ? Math.round(totalScreenTime / totalSessions) : 0;

  const exportCSV = () => {
    const headers = ["User", "Sessions", "Page Views", "Total Screen Time (min)", "Avg Session (min)", "Last Active"];
    const rows = filteredStats.map((s) => [
      s.displayName,
      s.sessionCount,
      s.pageViews,
      Math.round(s.totalSeconds / 60),
      s.sessionCount > 0 ? Math.round(s.totalSeconds / s.sessionCount / 60) : 0,
      format(new Date(s.lastActive), "yyyy-MM-dd HH:mm"),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `user-analytics-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{isLoading ? "–" : totalUsers}</p>
              <p className="text-xs text-muted-foreground">Active Users</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <LogIn className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{isLoading ? "–" : totalSessions}</p>
              <p className="text-xs text-muted-foreground">Total Sessions</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{isLoading ? "–" : formatDuration(totalScreenTime)}</p>
              <p className="text-xs text-muted-foreground">Total Screen Time</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{isLoading ? "–" : formatDuration(avgSessionTime)}</p>
              <p className="text-xs text-muted-foreground">Avg Session</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={period} onValueChange={(v) => setPeriod(v as TimePeriod)}>
          <SelectTrigger className="w-[130px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="14d">Last 14 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>

        <Select value={clubFilter} onValueChange={setClubFilter}>
          <SelectTrigger className="w-[200px] h-9 text-sm">
            <SelectValue placeholder="All Clubs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clubs</SelectItem>
            {clubs?.map((club) => (
              <SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      {/* User Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : filteredStats.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No activity data yet</p>
            <p className="text-sm mt-1">Activity tracking starts collecting data as users browse the app.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-center">Sessions</TableHead>
                  <TableHead className="text-center">Page Views</TableHead>
                  <TableHead className="text-center">Screen Time</TableHead>
                  <TableHead className="text-center">Avg/Session</TableHead>
                  <TableHead className="hidden sm:table-cell">Top Pages</TableHead>
                  <TableHead className="text-right">Last Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStats.map((stat) => {
                  const topPages = Object.entries(stat.topPages)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3);

                  return (
                    <TableRow key={stat.userId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={stat.avatarUrl || undefined} />
                            <AvatarFallback className="text-xs">
                              {stat.displayName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm truncate max-w-[150px]">
                            {stat.displayName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {stat.sessionCount}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {stat.pageViews}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {formatDuration(stat.totalSeconds)}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {stat.sessionCount > 0
                          ? formatDuration(Math.round(stat.totalSeconds / stat.sessionCount))
                          : "–"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex gap-1 flex-wrap">
                          {topPages.map(([page, count]) => (
                            <Badge key={page} variant="secondary" className="text-[10px] px-1.5 py-0">
                              {page} ({count})
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(stat.lastActive), "dd MMM HH:mm")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
