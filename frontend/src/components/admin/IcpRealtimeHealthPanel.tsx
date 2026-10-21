import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Activity, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getActiveIcpTarget } from "@/live/targetRegistry";
import { DOMAIN_LABELS } from "@/live/domains";
import {
  CHAT_POLL_INTERVAL_VISIBLE_MS,
  CHAT_POLL_INTERVAL_HIDDEN_MS,
} from "@/hooks/useClubRealtimeMode";

type CanisterProbe = {
  key: string;
  label: string;
  canisterId: string;
  reachable: boolean;
  ms: number;
  error?: string;
};

async function probeCanisters(): Promise<CanisterProbe[]> {
  const target = getActiveIcpTarget();
  const entries = Object.entries(target.canisterIds ?? {}).filter(([, id]) => !!id);
  if (entries.length === 0) return [];

  const [{ HttpAgent, Actor, AnonymousIdentity }, { IDL }] = await Promise.all([
    import("@icp-sdk/core/agent"),
    import("@icp-sdk/core/candid"),
  ]);
  const agent = await HttpAgent.create({ host: target.host, identity: new AnonymousIdentity() });
  // `cycles_balance` is a cheap, no-argument query implemented by every
  // domain canister — used purely here as a reachability/latency probe, not
  // to read the actual balance (see the Group Infrastructure page for that).
  const idl = () => IDL.Service({ cycles_balance: IDL.Func([], [IDL.Nat], ["query"]) });

  return Promise.all(
    entries.map(async ([key, canisterId]): Promise<CanisterProbe> => {
      const label = DOMAIN_LABELS[key] ?? key;
      const started = performance.now();
      try {
        const actor = Actor.createActor<{ cycles_balance: () => Promise<bigint> }>(idl, { agent, canisterId });
        await actor.cycles_balance();
        return { key, label, canisterId, reachable: true, ms: Math.round(performance.now() - started) };
      } catch (error) {
        return {
          key,
          label,
          canisterId,
          reachable: false,
          ms: Math.round(performance.now() - started),
          error: String(error),
        };
      }
    }),
  );
}

/**
 * ICP-lab equivalent of the Supabase Realtime Health page: there is no
 * concurrent-connection concept for canister query calls, so instead this
 * times a lightweight query against every configured canister to give
 * admins a reachability + latency snapshot, alongside the client chat
 * polling cadence (ICP messaging has no websocket fan-out — clients poll).
 */
export function IcpRealtimeHealthPanel() {
  const navigate = useNavigate();

  const { data: probes, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["icp-realtime-health-probes"],
    queryFn: probeCanisters,
    refetchInterval: 30_000,
  });

  const reachableCount = (probes ?? []).filter((p) => p.reachable).length;
  const total = probes?.length ?? 0;

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Realtime Health</h1>
          <p className="text-sm text-muted-foreground">
            Canister reachability &amp; query latency (ICP lab mode)
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-5 w-5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5" />
            Canister health
          </CardTitle>
          <CardDescription>
            Times a lightweight query against each configured canister on {getActiveIcpTarget().alias}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Probing canisters…</p>}
          {!isLoading && total === 0 && (
            <p className="text-sm text-muted-foreground">No canister IDs configured for this target.</p>
          )}
          {total > 0 && (
            <p className="text-sm text-muted-foreground">
              {reachableCount}/{total} canisters reachable
            </p>
          )}
          <div className="space-y-2">
            {(probes ?? []).map((p) => (
              <div key={p.key} className="flex items-center justify-between gap-3 rounded-md border p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.label}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{p.canisterId}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs tabular-nums text-muted-foreground">{p.ms}ms</span>
                  <Badge variant={p.reachable ? "default" : "destructive"} className="flex items-center gap-1">
                    {p.reachable ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {p.reachable ? "Reachable" : "Unreachable"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Chat polling cadence</CardTitle>
          <CardDescription>
            ICP messaging has no websocket fan-out — clients poll on a visibility-aware cadence instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Badge variant="outline">Visible tab: every {CHAT_POLL_INTERVAL_VISIBLE_MS / 1000}s</Badge>
          <Badge variant="outline">Hidden tab: every {CHAT_POLL_INTERVAL_HIDDEN_MS / 1000}s</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
