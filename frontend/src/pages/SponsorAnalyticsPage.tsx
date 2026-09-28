import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Eye, MousePointer, TrendingUp } from "lucide-react";
import { subDays, startOfDay } from "date-fns";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

type DateRange = "7d" | "30d" | "90d" | "all";

interface SponsorStats {
  sponsor_id: string;
  sponsor_name: string;
  club_name: string | null;
  logo_url: string | null;
  total_views: number;
  total_clicks: number;
  click_rate: number;
}

interface ContextBreakdown {
  context: string;
  views: number;
  clicks: number;
}

export default function SponsorAnalyticsPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-3xl mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <Eye className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Sponsor analytics are unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Sponsor views, clicks, and reporting aggregates are not connected to an ICP service yet.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseSponsorAnalyticsPage />;
}

function SupabaseSponsorAnalyticsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [selectedSponsor, setSelectedSponsor] = useState<string | null>(null);
  const [selectedClub, setSelectedClub] = useState<string>("all");

  // Check if user is app admin
  const { data: isAppAdmin, isLoading: checkingAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Get date filter
  const getDateFilter = () => {
    const now = new Date();
    switch (dateRange) {
      case "7d":
        return startOfDay(subDays(now, 7)).toISOString();
      case "30d":
        return startOfDay(subDays(now, 30)).toISOString();
      case "90d":
        return startOfDay(subDays(now, 90)).toISOString();
      default:
        return null;
    }
  };

  // Fetch all clubs for the filter
  const { data: clubs } = useQuery({
    queryKey: ["all-clubs-for-filter"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("id, name")
        .order("name");
      return data || [];
    },
    enabled: isAppAdmin === true,
  });

  // Fetch sponsor analytics
  const { data: sponsorStats, isLoading } = useQuery({
    queryKey: ["sponsor-analytics", dateRange, selectedClub],
    queryFn: async () => {
      const dateFilter = getDateFilter();

      // Get sponsors with their clubs (use explicit FK relationship)
      let sponsorsQuery = supabase
        .from("sponsors")
        .select("id, name, logo_url, club_id, clubs!club_id(name)");

      if (selectedClub !== "all") {
        sponsorsQuery = sponsorsQuery.eq("club_id", selectedClub);
      }

      const { data: sponsors, error: sponsorsError } = await sponsorsQuery;

      if (sponsorsError) {
        console.error("Error fetching sponsors:", sponsorsError);
        return [];
      }

      if (!sponsors || sponsors.length === 0) return [];

      // Get analytics data
      let analyticsQuery = supabase
        .from("sponsor_analytics")
        .select("sponsor_id, event_type");

      if (dateFilter) {
        analyticsQuery = analyticsQuery.gte("created_at", dateFilter);
      }

      const { data: analytics, error: analyticsError } = await analyticsQuery;

      if (analyticsError) {
        console.error("Error fetching analytics:", analyticsError);
      }

      // Aggregate stats per sponsor
      const statsMap = new Map<string, { views: number; clicks: number }>();
      
      analytics?.forEach((event) => {
        const existing = statsMap.get(event.sponsor_id) || { views: 0, clicks: 0 };
        if (event.event_type === "view") {
          existing.views++;
        } else if (event.event_type === "click") {
          existing.clicks++;
        }
        statsMap.set(event.sponsor_id, existing);
      });

      // Combine with sponsor data
      const result: SponsorStats[] = sponsors.map((sponsor) => {
        const stats = statsMap.get(sponsor.id) || { views: 0, clicks: 0 };
        return {
          sponsor_id: sponsor.id,
          sponsor_name: sponsor.name,
          club_name: (sponsor.clubs as any)?.name || null,
          logo_url: sponsor.logo_url,
          total_views: stats.views,
          total_clicks: stats.clicks,
          click_rate: stats.views > 0 ? (stats.clicks / stats.views) * 100 : 0,
        };
      });

      // Sort by total views descending
      return result.sort((a, b) => b.total_views - a.total_views);
    },
    enabled: isAppAdmin === true,
  });

  // Fetch context breakdown for selected sponsor
  const { data: contextBreakdown } = useQuery({
    queryKey: ["sponsor-analytics-context", selectedSponsor, dateRange],
    queryFn: async () => {
      if (!selectedSponsor) return [];
      
      const dateFilter = getDateFilter();

      let query = supabase
        .from("sponsor_analytics")
        .select("context, event_type")
        .eq("sponsor_id", selectedSponsor);

      if (dateFilter) {
        query = query.gte("created_at", dateFilter);
      }

      const { data } = await query;

      // Aggregate by context
      const contextMap = new Map<string, { views: number; clicks: number }>();
      
      data?.forEach((event) => {
        const existing = contextMap.get(event.context) || { views: 0, clicks: 0 };
        if (event.event_type === "view") {
          existing.views++;
        } else if (event.event_type === "click") {
          existing.clicks++;
        }
        contextMap.set(event.context, existing);
      });

      const result: ContextBreakdown[] = [];
      contextMap.forEach((stats, context) => {
        result.push({
          context,
          views: stats.views,
          clicks: stats.clicks,
        });
      });

      return result.sort((a, b) => b.views - a.views);
    },
    enabled: !!selectedSponsor && isAppAdmin === true,
  });

  // Calculate totals
  const totals = sponsorStats?.reduce(
    (acc, stat) => ({
      views: acc.views + stat.total_views,
      clicks: acc.clicks + stat.total_clicks,
    }),
    { views: 0, clicks: 0 }
  ) || { views: 0, clicks: 0 };

  const formatContext = (context: string) => {
    return context
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  if (checkingAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAppAdmin) {
    return (
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              You don't have permission to view this page.
            </p>
            <Button className="mt-4" onClick={() => navigate("/")}>
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Sponsor Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Track sponsor logo views and click-throughs
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Club:</span>
          <Select value={selectedClub} onValueChange={setSelectedClub}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All clubs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clubs</SelectItem>
              {clubs?.map((club) => (
                <SelectItem key={club.id} value={club.id}>
                  {club.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Date Range:</span>
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Total Views
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totals.views.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MousePointer className="h-4 w-4" />
              Total Clicks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totals.clicks.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Click Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {totals.views > 0
                ? ((totals.clicks / totals.views) * 100).toFixed(1)
                : "0"}
              %
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sponsors Table */}
      <Card>
        <CardHeader>
          <CardTitle>Sponsor Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : sponsorStats?.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No analytics data available yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sponsor</TableHead>
                  <TableHead>Club</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Click Rate</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sponsorStats?.map((stat) => (
                  <TableRow key={stat.sponsor_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {stat.logo_url && (
                          <img
                            src={stat.logo_url}
                            alt={stat.sponsor_name}
                            className="h-8 w-8 object-contain rounded"
                          />
                        )}
                        <span className="font-medium">{stat.sponsor_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {stat.club_name || "-"}
                    </TableCell>
                    <TableCell className="text-right">{stat.total_views.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{stat.total_clicks.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {stat.click_rate.toFixed(1)}%
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSelectedSponsor(
                            selectedSponsor === stat.sponsor_id ? null : stat.sponsor_id
                          )
                        }
                      >
                        {selectedSponsor === stat.sponsor_id ? "Hide" : "Details"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Context Breakdown */}
      {selectedSponsor && contextBreakdown && contextBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Context Breakdown:{" "}
              {sponsorStats?.find((s) => s.sponsor_id === selectedSponsor)?.sponsor_name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Click Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contextBreakdown.map((ctx) => (
                  <TableRow key={ctx.context}>
                    <TableCell>{formatContext(ctx.context)}</TableCell>
                    <TableCell className="text-right">{ctx.views.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{ctx.clicks.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {ctx.views > 0 ? ((ctx.clicks / ctx.views) * 100).toFixed(1) : "0"}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
