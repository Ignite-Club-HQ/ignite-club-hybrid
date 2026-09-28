import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { 
  Bell, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Clock, 
  RefreshCw,
  Trash2,
  TrendingUp,
  TrendingDown,
  Users,
  Settings,
  Save,
  Smartphone
} from "lucide-react";
import { format, subDays, startOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

interface LogEntry {
  id: string;
  status: string;
  status_code: number | null;
  created_at: string;
  endpoint: string;
  error_message: string | null;
}

interface DailyStats {
  date: string;
  sent: number;
  failed: number;
  expired: number;
  skipped: number;
  total: number;
}

const STATUS_COLORS: Record<string, string> = {
  sent: 'hsl(142.1 76.2% 36.3%)', // green-600
  failed: 'hsl(0 84.2% 60.2%)', // red-500
  expired: 'hsl(47.9 95.8% 53.1%)', // yellow-500
  skipped: 'hsl(var(--muted-foreground))',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  sent: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  expired: <AlertCircle className="h-4 w-4 text-yellow-500" />,
  skipped: <Clock className="h-4 w-4 text-muted-foreground" />,
};

interface AlertSettings {
  id: string;
  failure_threshold_percent: number;
  check_window_hours: number;
  min_notifications: number;
  cooldown_hours: number;
  alerts_enabled: boolean;
}

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function PushAnalyticsPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="Push analytics are unavailable in ICP lab mode" description="Push delivery and analytics remain disabled external-provider workflows." />;
  }
  return <SupabasePushAnalyticsPage />;
}

function SupabasePushAnalyticsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [timeRange, setTimeRange] = useState("7");
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [localSettings, setLocalSettings] = useState<AlertSettings | null>(null);

  // Check if user is admin
  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch push notification logs
  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ["push-logs", timeRange],
    queryFn: async () => {
      const startDate = startOfDay(subDays(new Date(), parseInt(timeRange)));
      const { data, error } = await supabase
        .from("push_notification_logs")
        .select("id, status, status_code, created_at, endpoint, error_message")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) throw error;
      return data as LogEntry[];
    },
    enabled: isAdmin === true,
  });

  // Fetch subscription count with platform breakdown
  const { data: subscriptionStats } = useQuery({
    queryKey: ["push-subscription-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("platform, failure_count, last_success_at, created_at");

      if (error) throw error;
      
      const stats = {
        total: data?.length || 0,
        byPlatform: {} as Record<string, { count: number; healthy: number; failing: number }>,
        healthy: 0,
        failing: 0,
      };
      
      for (const sub of data || []) {
        const platform = sub.platform || 'unknown';
        if (!stats.byPlatform[platform]) {
          stats.byPlatform[platform] = { count: 0, healthy: 0, failing: 0 };
        }
        stats.byPlatform[platform].count++;
        
        const isHealthy = (sub.failure_count || 0) === 0;
        if (isHealthy) {
          stats.byPlatform[platform].healthy++;
          stats.healthy++;
        } else {
          stats.byPlatform[platform].failing++;
          stats.failing++;
        }
      }
      
      return stats;
    },
    enabled: isAdmin === true,
  });

  // Keep legacy subscription count for backwards compat
  const subscriptionCount = subscriptionStats?.total || 0;

  // Fetch alert settings
  const { data: alertSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ["push-alert-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("push_alert_settings")
        .select("*")
        .limit(1)
        .single();

      if (error) throw error;
      if (!localSettings) setLocalSettings(data as AlertSettings);
      return data as AlertSettings;
    },
    enabled: isAdmin === true,
  });

  // 24-hour push health snapshot — stuck placeholders, retry rate, missed
  // dispatches. Backed by the get_push_notification_health() SECURITY DEFINER
  // RPC so we can join across notifications + logs without loosening RLS.
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ["push-notification-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_push_notification_health");
      if (error) throw error;
      return data as {
        window_hours: number;
        generated_at: string;
        total_24h: number;
        sent_real: number;
        failed_24h: number;
        expired_24h: number;
        skipped_24h: number;
        stuck_placeholders: number;
        pending_inflight: number;
        legacy_retry_placeholders: number;
        notifications_with_retries: number;
        missed_notifications: number;
      };
    },
    enabled: isAdmin === true,
    refetchInterval: 60_000,
  });

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: async (settings: Partial<AlertSettings>) => {
      if (!alertSettings?.id) throw new Error("No settings found");
      const { error } = await supabase
        .from("push_alert_settings")
        .update({
          ...settings,
          updated_at: new Date().toISOString(),
          updated_by: user?.id,
        })
        .eq("id", alertSettings.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["push-alert-settings"] });
      toast({ title: "Settings saved", description: "Alert thresholds updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  // Calculate stats
  const stats = logs ? {
    total: logs.length,
    sent: logs.filter(l => l.status === 'sent').length,
    failed: logs.filter(l => l.status === 'failed').length,
    expired: logs.filter(l => l.status === 'expired').length,
    skipped: logs.filter(l => l.status === 'skipped').length,
  } : { total: 0, sent: 0, failed: 0, expired: 0, skipped: 0 };

  const successRate = stats.total > 0 
    ? Math.round((stats.sent / stats.total) * 100) 
    : 0;

  // Group logs by day for chart
  const dailyStats: DailyStats[] = logs ? (() => {
    const dayMap = new Map<string, DailyStats>();
    
    for (const log of logs) {
      const date = format(new Date(log.created_at), 'MMM dd');
      const existing = dayMap.get(date) || { date, sent: 0, failed: 0, expired: 0, skipped: 0, total: 0 };
      existing[log.status as keyof Omit<DailyStats, 'date' | 'total'>]++;
      existing.total++;
      dayMap.set(date, existing);
    }

    return Array.from(dayMap.values()).reverse();
  })() : [];

  // Pie chart data
  const pieData = [
    { name: 'Sent', value: stats.sent, color: STATUS_COLORS.sent },
    { name: 'Failed', value: stats.failed, color: STATUS_COLORS.failed },
    { name: 'Expired', value: stats.expired, color: STATUS_COLORS.expired },
    { name: 'Skipped', value: stats.skipped, color: STATUS_COLORS.skipped },
  ].filter(d => d.value > 0);

  // Run cleanup
  const handleCleanup = async () => {
    setIsCleaningUp(true);
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-push-subscriptions');
      
      if (error) throw error;
      
      toast({
        title: "Cleanup Complete",
        description: `Removed ${data.subscriptions_removed} stale subscriptions`,
      });
      
      refetchLogs();
    } catch (error: any) {
      toast({
        title: "Cleanup Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsCleaningUp(false);
    }
  };

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (isAdmin === false) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-6 w-6" />
              Push Notification Analytics
            </h1>
            <p className="text-muted-foreground">
              Monitor push notification delivery performance
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant={showSettings ? "default" : "outline"} 
              size="icon"
              onClick={() => {
                setShowSettings(!showSettings);
                if (!showSettings && alertSettings) {
                  setLocalSettings(alertSettings);
                }
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 24 hours</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetchLogs()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Alert Settings Panel */}
        {showSettings && (
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Alert Settings
              </CardTitle>
              <CardDescription>
                Configure when email alerts are sent to app admins
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settingsLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : localSettings ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="alerts-enabled">Enable Email Alerts</Label>
                      <p className="text-sm text-muted-foreground">
                        Send email alerts when failure rate exceeds threshold
                      </p>
                    </div>
                    <Switch
                      id="alerts-enabled"
                      checked={localSettings.alerts_enabled}
                      onCheckedChange={(checked) => 
                        setLocalSettings({ ...localSettings, alerts_enabled: checked })
                      }
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="threshold">Failure Threshold (%)</Label>
                      <Input
                        id="threshold"
                        type="number"
                        min={1}
                        max={100}
                        value={localSettings.failure_threshold_percent}
                        onChange={(e) => 
                          setLocalSettings({ 
                            ...localSettings, 
                            failure_threshold_percent: parseInt(e.target.value) || 20 
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Alert when failure rate exceeds this %
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="window">Check Window (hours)</Label>
                      <Input
                        id="window"
                        type="number"
                        min={1}
                        max={168}
                        value={localSettings.check_window_hours}
                        onChange={(e) => 
                          setLocalSettings({ 
                            ...localSettings, 
                            check_window_hours: parseInt(e.target.value) || 24 
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Time window to analyze
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="min-notifications">Minimum Notifications</Label>
                      <Input
                        id="min-notifications"
                        type="number"
                        min={1}
                        max={1000}
                        value={localSettings.min_notifications}
                        onChange={(e) => 
                          setLocalSettings({ 
                            ...localSettings, 
                            min_notifications: parseInt(e.target.value) || 10 
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Required before alerting
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cooldown">Cooldown (hours)</Label>
                      <Input
                        id="cooldown"
                        type="number"
                        min={1}
                        max={72}
                        value={localSettings.cooldown_hours}
                        onChange={(e) => 
                          setLocalSettings({ 
                            ...localSettings, 
                            cooldown_hours: parseInt(e.target.value) || 6 
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Time between alerts
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setLocalSettings(alertSettings || null);
                        setShowSettings(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        updateSettings.mutate({
                          failure_threshold_percent: localSettings.failure_threshold_percent,
                          check_window_hours: localSettings.check_window_hours,
                          min_notifications: localSettings.min_notifications,
                          cooldown_hours: localSettings.cooldown_hours,
                          alerts_enabled: localSettings.alerts_enabled,
                        });
                        setShowSettings(false);
                      }}
                      disabled={updateSettings.isPending}
                    >
                      {updateSettings.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Save Settings
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">Failed to load settings</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Notifications</CardDescription>
              <CardTitle className="text-3xl">
                {logsLoading ? <Skeleton className="h-9 w-20" /> : stats.total.toLocaleString()}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Last {timeRange} day{timeRange !== "1" ? "s" : ""}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Success Rate</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                {logsLoading ? (
                  <Skeleton className="h-9 w-20" />
                ) : (
                  <>
                    {successRate}%
                    {successRate >= 90 ? (
                      <TrendingUp className="h-5 w-5 text-green-500" />
                    ) : successRate >= 70 ? (
                      <TrendingUp className="h-5 w-5 text-yellow-500" />
                    ) : (
                      <TrendingDown className="h-5 w-5 text-destructive" />
                    )}
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Progress value={successRate} className="h-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active Subscriptions</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                {subscriptionCount !== undefined ? (
                  <>
                    {subscriptionCount}
                    <Users className="h-5 w-5 text-muted-foreground" />
                  </>
                ) : (
                  <Skeleton className="h-9 w-20" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Registered devices
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failed Deliveries</CardDescription>
              <CardTitle className="text-3xl text-destructive">
                {logsLoading ? <Skeleton className="h-9 w-20" /> : stats.failed}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleCleanup}
                disabled={isCleaningUp}
              >
                {isCleaningUp ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Cleanup Stale
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* 24-Hour Health Dashboard */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                24-Hour Health
              </CardTitle>
              <CardDescription>
                Real-time delivery integrity. Stuck or missed counts above zero indicate a backend issue.
              </CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={() => refetchHealth()}>
              <RefreshCw className={`h-4 w-4 ${healthLoading ? "animate-spin" : ""}`} />
            </Button>
          </CardHeader>
          <CardContent>
            {healthLoading && !health ? (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : health ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <HealthTile label="Sent (real)" value={health.sent_real} icon={<CheckCircle className="h-4 w-4 text-green-500" />} />
                  <HealthTile label="Failed" value={health.failed_24h} tone={health.failed_24h > 0 ? "warn" : "ok"} icon={<XCircle className="h-4 w-4 text-destructive" />} />
                  <HealthTile label="Expired" value={health.expired_24h} icon={<AlertCircle className="h-4 w-4 text-yellow-500" />} />
                  <HealthTile label="Skipped (preferences)" value={health.skipped_24h} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
                  <HealthTile label="Stuck placeholders (>5m)" value={health.stuck_placeholders} tone={health.stuck_placeholders > 0 ? "danger" : "ok"} hint="Pre-claim rows that never finalised" />
                  <HealthTile label="Pending in-flight (<5m)" value={health.pending_inflight} hint="Currently being processed — should clear within seconds" />
                  <HealthTile label="Legacy retry placeholders" value={health.legacy_retry_placeholders} tone={health.legacy_retry_placeholders > 50 ? "warn" : "ok"} hint="Old rows from the broken retry path. Safe to clean up." />
                  <HealthTile label="Notifications with retries" value={health.notifications_with_retries} hint={health.total_24h > 0 ? `${((health.notifications_with_retries / Math.max(health.total_24h, 1)) * 100).toFixed(1)}% of 24h volume` : "—"} />
                </div>
                {health.missed_notifications > 0 && (
                  <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <div className="font-semibold text-destructive">
                      {health.missed_notifications} notification(s) had no push log in the last 24h
                    </div>
                    <p className="text-muted-foreground mt-1">
                      Created &gt;2 minutes ago with skip_push=false but never reached send-push-notification. Check pg_net deliveries and the retry-missed-push-notifications cron.
                    </p>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  Updated {new Date(health.generated_at).toLocaleTimeString()} · auto-refresh every 60s
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No health data available.</p>
            )}
          </CardContent>
        </Card>


        {/* Platform Breakdown */}
        {subscriptionStats && Object.keys(subscriptionStats.byPlatform).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                Platform Breakdown
              </CardTitle>
              <CardDescription>
                Subscription health by platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(subscriptionStats.byPlatform)
                  .sort(([, a], [, b]) => b.count - a.count)
                  .map(([platform, data]) => {
                    const healthPercent = data.count > 0 
                      ? Math.round((data.healthy / data.count) * 100) 
                      : 0;
                    return (
                      <div key={platform} className="p-4 rounded-lg bg-muted/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium capitalize">{platform}</span>
                          <Badge variant="outline">{data.count}</Badge>
                        </div>
                        <Progress value={healthPercent} className="h-2" />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span className="text-green-500">{data.healthy} healthy</span>
                          {data.failing > 0 && (
                            <span className="text-destructive">{data.failing} failing</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                }
              </div>
              
              {/* Overall Health Summary */}
              <div className="mt-4 pt-4 border-t flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Overall Health:</span>
                  <Badge variant={subscriptionStats.failing === 0 ? "default" : subscriptionStats.failing < subscriptionStats.healthy ? "secondary" : "destructive"}>
                    {subscriptionStats.total > 0 
                      ? Math.round((subscriptionStats.healthy / subscriptionStats.total) * 100) 
                      : 0}% healthy
                  </Badge>
                </div>
                {subscriptionStats.failing > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {subscriptionStats.failing} subscription(s) have delivery issues
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Bar Chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Daily Delivery Stats</CardTitle>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : dailyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dailyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Bar dataKey="sent" name="Sent" fill={STATUS_COLORS.sent} stackId="a" />
                    <Bar dataKey="failed" name="Failed" fill={STATUS_COLORS.failed} stackId="a" />
                    <Bar dataKey="expired" name="Expired" fill={STATUS_COLORS.expired} stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Status Legend */}
        <Card>
          <CardHeader>
            <CardTitle>Status Legend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-2">
                {STATUS_ICONS.sent}
                <span className="font-medium">Sent</span>
                <span className="text-muted-foreground text-sm">
                  - Successfully delivered to push service
                </span>
              </div>
              <div className="flex items-center gap-2">
                {STATUS_ICONS.failed}
                <span className="font-medium">Failed</span>
                <span className="text-muted-foreground text-sm">
                  - Push service rejected the notification
                </span>
              </div>
              <div className="flex items-center gap-2">
                {STATUS_ICONS.expired}
                <span className="font-medium">Expired</span>
                <span className="text-muted-foreground text-sm">
                  - Subscription no longer valid (410/404)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {STATUS_ICONS.skipped}
                <span className="font-medium">Skipped</span>
                <span className="text-muted-foreground text-sm">
                  - Invalid subscription data
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Logs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Delivery Logs</CardTitle>
            <CardDescription>Last 50 push notification attempts</CardDescription>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : logs && logs.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {logs.slice(0, 50).map((log) => (
                  <div 
                    key={log.id} 
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      {STATUS_ICONS[log.status]}
                      <div>
                        <p className="text-sm font-medium">
                          {log.endpoint.substring(0, 50)}...
                        </p>
                        {log.error_message && (
                          <p className="text-xs text-muted-foreground">
                            {log.error_message}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {log.status_code && (
                        <Badge variant={log.status_code >= 200 && log.status_code < 300 ? "default" : "destructive"}>
                          {log.status_code}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(log.created_at), 'MMM dd HH:mm')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No logs available for this time period
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}

interface HealthTileProps {
  label: string;
  value: number;
  hint?: string;
  tone?: "ok" | "warn" | "danger";
  icon?: React.ReactNode;
}

function HealthTile({ label, value, hint, tone = "ok", icon }: HealthTileProps) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/50 bg-destructive/5"
      : tone === "warn"
      ? "border-yellow-500/40 bg-yellow-500/5"
      : "border-border";
  const valueClass =
    tone === "danger" ? "text-destructive" : tone === "warn" ? "text-yellow-600 dark:text-yellow-400" : "";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{value.toLocaleString()}</div>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{hint}</p>}
    </div>
  );
}
