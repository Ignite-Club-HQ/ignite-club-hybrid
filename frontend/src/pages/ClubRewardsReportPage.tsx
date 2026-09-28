import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Calendar, Filter, Lock } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { downloadTextReport } from "@/lib/reportExport";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClubDetail, getLocalLabRewardRedemptions, getLocalLabTeamList } from "@/lab/fixtureDataLayer";

export default function ClubRewardsReportPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  
  // Default to current month
  const [startDate, setStartDate] = useState<Date>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");
  const [startCalendarOpen, setStartCalendarOpen] = useState(false);
  const [endCalendarOpen, setEndCalendarOpen] = useState(false);

  // Fetch club subscription
  const { data: clubSubscription, isLoading: isLoadingSub } = useQuery({
    queryKey: ["club-subscription", clubId],
    queryFn: async () => {
      if (useIcpLab) return { is_pro: true };
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", clubId!)
        .maybeSingle();
      return data;
    },
    enabled: !!clubId,
  });

  // Check if app admin or club admin
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (useIcpLab) return true;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  const { data: isClubAdmin } = useQuery({
    queryKey: ["is-club-admin-rewards-report", user?.id, clubId],
    queryFn: async () => {
      if (useIcpLab) return true;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "club_admin")
        .eq("club_id", clubId!)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && !!clubId,
  });

  const hasPro = isAppAdmin || clubSubscription?.is_pro || clubSubscription?.is_pro_football || 
                 clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override;

  // Fetch teams for filter
  const { data: teams = [] } = useQuery({
    queryKey: ["club-teams-for-report", clubId],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabTeamList()
          .filter((team) => team.club_id === clubId)
          .map(({ id, name }) => ({ id, name }));
      }
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("club_id", clubId!)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!clubId && hasPro,
  });

  // Fetch club info
  const { data: club } = useQuery({
    queryKey: ["club-info", clubId],
    queryFn: async () => {
      if (useIcpLab) {
        const localClub = getLocalLabClubDetail(clubId!);
        return localClub ? { name: localClub.name } : null;
      }
      const { data, error } = await supabase
        .from("clubs")
        .select("name")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Fetch redemptions with filters
  const { data: redemptions = [], isLoading } = useQuery({
    queryKey: ["rewards-report", clubId, startDate, endDate, selectedTeamId],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabRewardRedemptions(clubId!).filter((redemption) => {
          const redeemedAt = new Date(redemption.redeemed_at);
          return redeemedAt >= startDate && redeemedAt <= endDate;
        });
      }
      // First, get redemptions within date range
      let query = supabase
        .from("reward_redemptions")
        .select(`
          id,
          points_spent,
          status,
          redeemed_at,
          child_id,
          user_id,
          club_rewards (id, name, reward_type),
          children (id, name),
          profiles:user_id (id, display_name)
        `)
        .eq("club_id", clubId!)
        .gte("redeemed_at", startDate.toISOString())
        .lte("redeemed_at", endDate.toISOString())
        .order("redeemed_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      // If filtering by team, we need to filter users who are members of that team
      if (selectedTeamId !== "all" && data) {
        const { data: teamMembers } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", selectedTeamId);

        const teamMemberIds = new Set(teamMembers?.map(m => m.user_id) || []);
        
        // Also get children assigned to this team
        const { data: childAssignments } = await supabase
          .from("child_team_assignments")
          .select("child_id")
          .eq("team_id", selectedTeamId);
        
        const teamChildIds = new Set(childAssignments?.map(c => c.child_id) || []);

        return data.filter(r => 
          teamMemberIds.has(r.user_id) || 
          (r.child_id && teamChildIds.has(r.child_id))
        );
      }

      return data || [];
    },
    enabled: !!clubId,
  });

  // Aggregate data by reward type
  const aggregatedData = redemptions.reduce((acc, redemption) => {
    const rewardName = redemption.club_rewards?.name || "Unknown Reward";
    const rewardType = redemption.club_rewards?.reward_type || "custom";
    
    if (!acc[rewardName]) {
      acc[rewardName] = {
        name: rewardName,
        type: rewardType,
        pending: 0,
        fulfilled: 0,
        total: 0,
        totalPoints: 0,
      };
    }
    
    acc[rewardName].total += 1;
    acc[rewardName].totalPoints += redemption.points_spent;
    
    if (redemption.status === "pending") {
      acc[rewardName].pending += 1;
    } else if (redemption.status === "fulfilled") {
      acc[rewardName].fulfilled += 1;
    }
    
    return acc;
  }, {} as Record<string, { name: string; type: string; pending: number; fulfilled: number; total: number; totalPoints: number }>);

  const aggregatedArray = Object.values(aggregatedData).sort((a, b) => b.total - a.total);

  const totalRedemptions = redemptions.length;
  const totalPending = redemptions.filter(r => r.status === "pending").length;
  const totalFulfilled = redemptions.filter(r => r.status === "fulfilled").length;
  const totalPointsSpent = redemptions.reduce((sum, r) => sum + r.points_spent, 0);

  // Quick date presets
  const setDatePreset = (preset: string) => {
    const now = new Date();
    switch (preset) {
      case "thisMonth":
        setStartDate(startOfMonth(now));
        setEndDate(endOfMonth(now));
        break;
      case "lastMonth":
        setStartDate(startOfMonth(subMonths(now, 1)));
        setEndDate(endOfMonth(subMonths(now, 1)));
        break;
      case "last3Months":
        setStartDate(startOfMonth(subMonths(now, 2)));
        setEndDate(endOfMonth(now));
        break;
    }
  };

  const handleDownload = async () => {
    // Create CSV content
    const headers = ["Reward Name", "Type", "Pending", "Fulfilled", "Total", "Points Spent"];
    const rows = aggregatedArray.map(row => [
      row.name,
      row.type,
      row.pending,
      row.fulfilled,
      row.total,
      row.totalPoints,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(",")),
      "",
      `Total Redemptions,${totalRedemptions}`,
      `Total Pending,${totalPending}`,
      `Total Fulfilled,${totalFulfilled}`,
      `Total Points Spent,${totalPointsSpent}`,
    ].join("\n");

    const fileName = `rewards-report-${format(startDate, "yyyy-MM-dd")}-to-${format(endDate, "yyyy-MM-dd")}.csv`;
    try {
      await downloadTextReport(csvContent, fileName, "text/csv");
    } catch (error) {
      console.error("Failed to export rewards report:", error);
    }
  };

  if (!clubId) return null;

  // Show locked state for non-Pro users
  if (!isLoadingSub && !hasPro) {
    return (
      <div className="container max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/clubs/${clubId}`)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Rewards Report</h1>
            <p className="text-sm text-muted-foreground">{club?.name}</p>
          </div>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Pro Feature</h2>
            <p className="text-muted-foreground mb-4 max-w-sm">
              Rewards reports are available with a Pro subscription. Upgrade to unlock this feature.
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">Pro Only</Badge>
            </div>
            {(isAppAdmin || isClubAdmin) ? (
              <Button 
                className="mt-4"
                onClick={() => navigate(`/clubs/${clubId}/upgrade`)}
              >
                Upgrade to Pro
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground mt-4">
                Contact your club administrator to upgrade.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/clubs/${clubId}/rewards`)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Rewards Report</h1>
            <p className="text-sm text-muted-foreground">{club?.name}</p>
          </div>

          {useIcpLab && (
            <Alert>
              <AlertDescription>
                This report uses synthetic ICP lab data. Reward fulfilment and redemption changes are unavailable.
              </AlertDescription>
            </Alert>
          )}
        </div>
        <Button onClick={handleDownload} disabled={isLoading || redemptions.length === 0} size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quick Date Presets */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDatePreset("thisMonth")}
            >
              This Month
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDatePreset("lastMonth")}
            >
              Last Month
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDatePreset("last3Months")}
            >
              Last 3 Months
            </Button>
          </div>

          {/* Date Range - Responsive */}
          <div className={cn(
            "grid gap-4",
            isMobile ? "grid-cols-1" : "grid-cols-2 md:grid-cols-3"
          )}>
            {/* Start Date */}
            <div className="space-y-2">
              <Label>Start Date</Label>
              {isMobile ? (
                <>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    onClick={() => setStartCalendarOpen(true)}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "PPP") : "Pick a date"}
                  </Button>
                  <Drawer open={startCalendarOpen} onOpenChange={setStartCalendarOpen}>
                    <DrawerContent>
                      <DrawerHeader>
                        <DrawerTitle>Select Start Date</DrawerTitle>
                      </DrawerHeader>
                      <div className="flex justify-center pb-8 px-4">
                        <CalendarComponent
                          mode="single"
                          selected={startDate}
                          onSelect={(date) => {
                            if (date) {
                              setStartDate(date);
                              setStartCalendarOpen(false);
                            }
                          }}
                          className="p-4 pointer-events-auto w-full max-w-sm [&_.rdp-months]:w-full [&_.rdp-month]:w-full [&_.rdp-table]:w-full [&_.rdp-head_cell]:text-base [&_.rdp-head_cell]:py-2 [&_.rdp-cell]:text-lg [&_.rdp-day]:h-12 [&_.rdp-day]:w-full [&_.rdp-button]:h-12 [&_.rdp-button]:w-full [&_.rdp-button]:text-lg [&_.rdp-nav_button]:h-10 [&_.rdp-nav_button]:w-10 [&_.rdp-caption_label]:text-lg"
                        />
                      </div>
                    </DrawerContent>
                  </Drawer>
                </>
              ) : (
                <Popover open={startCalendarOpen} onOpenChange={setStartCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-auto" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={startDate}
                      onSelect={(date) => {
                        if (date) {
                          setStartDate(date);
                          setStartCalendarOpen(false);
                        }
                      }}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label>End Date</Label>
              {isMobile ? (
                <>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    onClick={() => setEndCalendarOpen(true)}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "PPP") : "Pick a date"}
                  </Button>
                  <Drawer open={endCalendarOpen} onOpenChange={setEndCalendarOpen}>
                    <DrawerContent>
                      <DrawerHeader>
                        <DrawerTitle>Select End Date</DrawerTitle>
                      </DrawerHeader>
                      <div className="flex justify-center pb-8 px-4">
                        <CalendarComponent
                          mode="single"
                          selected={endDate}
                          onSelect={(date) => {
                            if (date) {
                              setEndDate(date);
                              setEndCalendarOpen(false);
                            }
                          }}
                          className="p-4 pointer-events-auto w-full max-w-sm [&_.rdp-months]:w-full [&_.rdp-month]:w-full [&_.rdp-table]:w-full [&_.rdp-head_cell]:text-base [&_.rdp-head_cell]:py-2 [&_.rdp-cell]:text-lg [&_.rdp-day]:h-12 [&_.rdp-day]:w-full [&_.rdp-button]:h-12 [&_.rdp-button]:w-full [&_.rdp-button]:text-lg [&_.rdp-nav_button]:h-10 [&_.rdp-nav_button]:w-10 [&_.rdp-caption_label]:text-lg"
                        />
                      </div>
                    </DrawerContent>
                  </Drawer>
                </>
              ) : (
                <Popover open={endCalendarOpen} onOpenChange={setEndCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-auto" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={endDate}
                      onSelect={(date) => {
                        if (date) {
                          setEndDate(date);
                          setEndCalendarOpen(false);
                        }
                      }}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {/* Team Filter */}
            <div className="space-y-2">
              <Label>Team</Label>
              <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All Teams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Teams</SelectItem>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{totalRedemptions}</div>
            <p className="text-sm text-muted-foreground">Total Redemptions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600">{totalPending}</div>
            <p className="text-sm text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-emerald-600">{totalFulfilled}</div>
            <p className="text-sm text-muted-foreground">Fulfilled</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{totalPointsSpent}</div>
            <p className="text-sm text-muted-foreground">Points Spent</p>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <CardTitle>Redemptions by Reward</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : aggregatedArray.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No redemptions found for the selected filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reward</TableHead>
                    <TableHead className="text-center">Pending</TableHead>
                    <TableHead className="text-center">Fulfilled</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregatedArray.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-center text-amber-600">{row.pending}</TableCell>
                      <TableCell className="text-center text-emerald-600">{row.fulfilled}</TableCell>
                      <TableCell className="text-center font-semibold">{row.total}</TableCell>
                      <TableCell className="text-right hidden sm:table-cell">{row.totalPoints}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
