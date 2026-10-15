import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Eraser, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MemoryReport } from "@/lib/canisterMemoryReports";

/**
 * Early-warning view for the 4 GB per-canister memory ceiling. Projects the
 * date each canister hits the ceiling from saved readings (history + live),
 * and offers the cleanup that canister actually supports on-chain.
 */

import { CEILING_MB, forecastMemory, type Forecast, type LiveMem } from "./canisterMemoryForecast";

type Cleanup = { label: string; help: string; run: () => Promise<string> };

async function icpCtx() {
  const [{ withFeatureBackend }, domains, { unwrapCandid }] = await Promise.all([
    import("@/live/featureRouter"),
    import("@/live/domains"),
    import("@/live/features/candid"),
  ]);
  return { withFeatureBackend, domains, unwrapCandid };
}

const CLEANUPS: Record<string, Cleanup> = {
  club_domain: {
    label: "Purge deleted clubs",
    help: "Permanently removes clubs and teams whose 30-day deletion window has passed (owner/governor sign-in only).",
    run: async () => {
      const { withFeatureBackend, domains } = await icpCtx();
      return withFeatureBackend("admin", {
        supabase: async () => { throw new Error("Sign in with Internet Identity to run on-chain cleanup."); },
        icp: async (ctx) => {
          const { actor } = await domains.connectLiveClubDomain(ctx.target, ctx.identity);
          const res: any = await actor.purge_expired_deletions();
          if ("Err" in res) throw new Error(res.Err);
          return `Purged ${res.Ok} expired club/team deletions.`;
        },
      });
    },
  },
  notification_queue: {
    label: "Remove stale devices",
    help: "Deletes push device registrations not refreshed in 90 days.",
    run: async () => {
      const { withFeatureBackend, domains } = await icpCtx();
      return withFeatureBackend("admin", {
        supabase: async () => { throw new Error("Sign in with Internet Identity to run on-chain cleanup."); },
        icp: async (ctx) => {
          const { actor } = await domains.connectLiveNotificationQueue(ctx.target, ctx.identity);
          const now = BigInt(Date.now());
          const res: any = await (actor as any).cleanup_stale_device_tokens(now, BigInt(90 * 86_400_000));
          if ("Err" in res) throw new Error(res.Err);
          return `Removed ${res.Ok} stale device registrations.`;
        },
      });
    },
  },
};

const ADVICE: Record<string, string> = {
  media_blob_store: "Free-club media older than 6 months is removed daily automatically. If still high, lower the capacity limit or add a second media store.",
  messaging_domain: "Old chats can be purged per group from Messages. Long term: move to a second messaging shard.",
  pii_access_control: "Access history is self-trimming (5,000 entries). Growth here means many new members — plan a shard.",
  insights_domain: "Self-trimming (200 reports). Growth here is unexpected — check recent deploys.",
};

function fmtMb(v: number | null) {
  if (v === null) return "—";
  return v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${Math.round(v)} MB`;
}

export function CanisterMemoryForecastCard({ live, history }: { live: LiveMem[]; history: MemoryReport[] }) {
  const forecasts = useMemo(
    () => forecastMemory(live, history).sort((a, b) => rank(b) - rank(a) || (b.memoryMb ?? 0) - (a.memoryMb ?? 0)),
    [live, history],
  );
  const flagged = forecasts.filter((f) => f.level === "act" || f.level === "watch");
  const noHistory = forecasts.every((f) => f.growthMbPerDay === null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory early warning</CardTitle>
        <CardDescription>
          Each canister stops accepting writes at 4 GB. Flags at 2.5 GB or 90 days from the limit ("Watch") and at
          3 GB or 30 days ("Act now"), so you have time to clean up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {flagged.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4" />No canister is approaching the limit.
          </p>
        ) : (
          <p className="text-sm text-destructive flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            {flagged.length} canister{flagged.length === 1 ? "" : "s"} need attention.
          </p>
        )}
        {noHistory && (
          <p className="text-xs text-muted-foreground">
            Growth forecasts need a saved reading at least a day old — press "Save live readings" below, or let the
            weekly health workflow save one.
          </p>
        )}
        <div className="space-y-2">
          {forecasts.map((f) => (
            <ForecastRow key={f.key} f={f} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function rank(f: Forecast) {
  return { act: 3, watch: 2, ok: 1, unknown: 0 }[f.level];
}

function ForecastRow({ f }: { f: Forecast }) {
  const cleanup = CLEANUPS[f.key];
  const run = useMutation({
    mutationFn: () => cleanup!.run(),
    onSuccess: (msg) => toast.success(msg),
    onError: (e) => toast.error((e as Error).message),
  });
  const pct = f.memoryMb !== null ? Math.min(100, (f.memoryMb / CEILING_MB) * 100) : 0;
  const showActions = f.level === "act" || f.level === "watch";
  return (
    <div className="border rounded-md p-2 space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{f.key}</span>
        {f.level === "act" && <Badge variant="destructive">Act now</Badge>}
        {f.level === "watch" && <Badge variant="secondary">Watch</Badge>}
        {f.level === "unknown" && <Badge variant="outline">No reading</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {fmtMb(f.memoryMb)} / 4 GB
          {f.growthMbPerDay !== null && ` · ${f.growthMbPerDay >= 0 ? "+" : ""}${f.growthMbPerDay.toFixed(1)} MB/day`}
          {f.daysToCeiling !== null && ` · full in ~${Math.round(f.daysToCeiling)} days`}
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded">
        <div
          className={`h-1.5 rounded ${f.level === "act" ? "bg-destructive" : f.level === "watch" ? "bg-accent-foreground" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {(showActions || cleanup) && (
        <div className="flex items-center gap-2 pt-1">
          {cleanup && (
            <Button size="sm" variant={showActions ? "default" : "outline"} onClick={() => run.mutate()} disabled={run.isPending} title={cleanup.help}>
              {run.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eraser className="h-3 w-3 mr-1" />}
              {cleanup.label}
            </Button>
          )}
          {showActions && (
            <span className="text-xs text-muted-foreground">
              {cleanup?.help ?? ADVICE[f.key] ?? "No on-chain cleanup for this canister — plan a shard or data archive."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
