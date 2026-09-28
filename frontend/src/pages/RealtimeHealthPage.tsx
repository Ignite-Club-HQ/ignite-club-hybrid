import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Activity, Users, Radio, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";

/**
 * Admin-only Realtime Health page.
 *
 * Two data sources:
 *   1. Client-side proxy — counts presences in the shared `app-presence`
 *      channel. Reflects users with the app currently in the foreground.
 *      Always available, no PAT required.
 *   2. Management API (optional) — calls the `realtime-stats` edge function
 *      which, if a `SUPABASE_PAT` secret is set, returns the true concurrent
 *      Realtime connection count from Supabase. Otherwise returns
 *      { supported: false } and we surface a hint.
 *
 * Plan caps (Pro plan, May 2026):
 *   - 500 concurrent connections
 *   - 2,500 messages / sec
 *   - 500 channel joins / sec
 */

const PLAN_CAP_CONNECTIONS = 500; // Pro plan default
const PROXY_CHANNEL = "realtime-health-probe";

function useProxyConnectionCount() {
  const [count, setCount] = useState<number>(0);
  const [connected, setConnected] = useState<boolean>(false);

  useEffect(() => {
    // We piggy-back on the existing `app-presence` channel by subscribing
    // a probe to it (read-only) so we get the same presence state every
    // other tab is publishing into.
    const probe = supabase.channel("app-presence");
    const recompute = () => {
      const state = probe.presenceState() as Record<string, unknown[]>;
      // Each presence key is a userId; count distinct keys with >=1 presence
      let n = 0;
      for (const k of Object.keys(state)) {
        if ((state[k]?.length ?? 0) > 0) n++;
      }
      setCount(n);
    };
    probe.on("presence", { event: "sync" }, recompute);
    probe.on("presence", { event: "join" }, recompute);
    probe.on("presence", { event: "leave" }, recompute);
    probe.subscribe((status) => {
      setConnected(status === "SUBSCRIBED");
      if (status === "SUBSCRIBED") recompute();
    });
    return () => {
      void supabase.removeChannel(probe);
    };
  }, []);

  return { count, connected };
}

type RealtimeStatsResponse =
  | { supported: true; concurrent_connections: number; messages_per_sec?: number; channel_joins_per_sec?: number; window_seconds: number; fetched_at: string }
  | { supported: false; reason: string };

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function RealtimeHealthPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="Realtime health monitoring is unavailable in ICP lab mode" description="This dashboard monitors Supabase realtime infrastructure and has no equivalent ICP service contract." />;
  }
  return <SupabaseRealtimeHealthPage />;
}

function SupabaseRealtimeHealthPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: isAppAdmin, isLoading: roleLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  const proxy = useProxyConnectionCount();

  const { data: dbHeartbeats, refetch: refetchHeartbeats, isFetching: heartbeatsFetching } = useQuery({
    queryKey: ["realtime-health-heartbeats"],
    queryFn: async () => {
      // Server-side cross-check: distinct user_ids with a heartbeat in the
      // last 60s (heartbeat cadence is 25s, so this catches every active tab).
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const { data, error } = await (supabase as any)
        .from("user_presence")
        .select("user_id, platform, last_seen_at")
        .gte("last_seen_at", cutoff);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ user_id: string; platform: string | null }>;
      const distinct = new Set(rows.map((r) => r.user_id)).size;
      const byPlatform = rows.reduce<Record<string, number>>((acc, r) => {
        const p = r.platform || "unknown";
        acc[p] = (acc[p] || 0) + 1;
        return acc;
      }, {});
      return { distinct, byPlatform, total: rows.length };
    },
    enabled: !!isAppAdmin,
    refetchInterval: 15_000,
  });

  const { data: mgmtStats, refetch: refetchMgmt, isFetching: mgmtFetching, error: mgmtError } = useQuery<RealtimeStatsResponse>({
    queryKey: ["realtime-health-mgmt"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("realtime-stats");
      if (error) throw error;
      return data as RealtimeStatsResponse;
    },
    enabled: !!isAppAdmin,
    refetchInterval: 30_000,
    retry: false,
  });

  const proxyPct = useMemo(
    () => Math.min(100, Math.round((proxy.count / PLAN_CAP_CONNECTIONS) * 100)),
    [proxy.count]
  );

  if (roleLoading) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Realtime Health</h1>
        </div>
        <p className="text-muted-foreground text-center py-12">
          Access denied. App admin role required.
        </p>
      </div>
    );
  }

  const pctTone =
    proxyPct >= 80 ? "text-destructive" : proxyPct >= 60 ? "text-amber-600 dark:text-amber-400" : "text-foreground";

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Realtime Health</h1>
          <p className="text-sm text-muted-foreground">
            Live concurrent connections vs plan cap
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            void refetchHeartbeats();
            void refetchMgmt();
          }}
          disabled={heartbeatsFetching || mgmtFetching}
        >
          <RefreshCw className={`h-5 w-5 ${heartbeatsFetching || mgmtFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Proxy: presence-based estimate */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" />
                Estimated concurrent users
              </CardTitle>
              <CardDescription>
                Live presence in <code>app-presence</code> channel
              </CardDescription>
            </div>
            <Badge variant={proxy.connected ? "default" : "secondary"}>
              {proxy.connected ? "Live" : "Connecting…"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className={`text-5xl font-bold tabular-nums ${pctTone}`}>{proxy.count}</span>
            <span className="text-muted-foreground">/ {PLAN_CAP_CONNECTIONS} Pro plan cap</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all ${
                proxyPct >= 80 ? "bg-destructive" : proxyPct >= 60 ? "bg-amber-500" : "bg-primary"
              }`}
              style={{ width: `${proxyPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Counts distinct user IDs currently broadcasting presence. Each user typically holds
            1 WebSocket connection multiplexed across 3–5 channels (presence, chat, pitch board,
            typing, notifications).
          </p>
        </CardContent>
      </Card>

      {/* DB heartbeats cross-check */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5" />
            Active heartbeats (last 60s)
          </CardTitle>
          <CardDescription>
            Server-side from <code>user_presence</code> table
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-3xl font-bold tabular-nums">
            {dbHeartbeats?.distinct ?? "—"}
          </div>
          {dbHeartbeats && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(dbHeartbeats.byPlatform).map(([platform, n]) => (
                <Badge key={platform} variant="outline">
                  {platform}: {n}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Management API (optional) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Radio className="h-5 w-5" />
            Supabase Realtime (Management API)
          </CardTitle>
          <CardDescription>
            True numbers reported by Supabase infrastructure
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {mgmtError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <div>Edge function error: {(mgmtError as Error).message}</div>
            </div>
          )}
          {mgmtStats && mgmtStats.supported && (
            <>
              <div className="text-3xl font-bold tabular-nums">
                {mgmtStats.concurrent_connections}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {typeof mgmtStats.messages_per_sec === "number" && (
                  <Badge variant="outline">{mgmtStats.messages_per_sec.toFixed(1)} msg/s</Badge>
                )}
                {typeof mgmtStats.channel_joins_per_sec === "number" && (
                  <Badge variant="outline">{mgmtStats.channel_joins_per_sec.toFixed(1)} joins/s</Badge>
                )}
                <span>window: {mgmtStats.window_seconds}s</span>
              </div>
            </>
          )}
          {mgmtStats && !mgmtStats.supported && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <div className="font-medium">Not configured</div>
                <div className="text-muted-foreground mt-1">
                  {(mgmtStats as { reason: string }).reason}
                </div>
                <div className="text-muted-foreground mt-2">
                  To enable: create a Personal Access Token at{" "}
                  <a
                    href="https://reference.invalid"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    supabase.com/dashboard/account/tokens
                  </a>{" "}
                  and add it as the <code>SUPABASE_PAT</code> secret.
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
