import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";

type Stat = { count: number; p50: number | null; p95: number | null };
type Row = { label: string; supabase: Stat | null; icp: Stat | null };

const DAYS = 30;
const SURFACES: { label: string; surface: string; table: string; column: string }[] = [
  { label: "Home screen open", surface: "home_open", table: "home_open_perf", column: "tap_to_paint_ms" },
  { label: "Messages list open", surface: "inbox_open", table: "inbox_open_perf", column: "tap_to_paint_ms" },
  { label: "Chat open", surface: "chat_open", table: "chat_open_perf", column: "tap_to_render_ms" },
  { label: "Schedule open", surface: "schedule_open", table: "schedule_open_perf", column: "tap_to_paint_ms" },
  { label: "Live updates", surface: "realtime", table: "realtime_perf_samples", column: "latency_ms" },
];

export function percentileStat(values: number[]): Stat {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { count: 0, p50: null, p95: null };
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return { count: v.length, p50: at(0.5), p95: at(0.95) };
}

async function loadSupabase(table: string, column: string, sinceIso: string): Promise<Stat | null> {
  try {
    const { data, error } = await (supabase as any)
      .from(table).select(column).gte("created_at", sinceIso).limit(1000);
    if (error) return null;
    return percentileStat((data ?? []).map((r: any) => Number(r[column])));
  } catch { return null; }
}

async function loadIcp(surface: string, sinceMs: number, untilMs: number): Promise<Stat | null> {
  try {
    return await withFeatureBackend<Stat | null>("analytics", {
      supabase: async () => null,
      icp: async (ctx) => {
        const { getLivePerfAggregate } = await import("@/live/features/insights");
        const a: any = await getLivePerfAggregate(ctx, surface, null, sinceMs, untilMs);
        const count = Number(a.count);
        return { count, p50: count ? Number(a.p50_ms) : null, p95: count ? Number(a.p95_ms) : null };
      },
    }, { shared: "app" });
  } catch { return null; }
}

async function loadAll(): Promise<Row[]> {
  const until = Date.now();
  const since = until - DAYS * 86_400_000;
  const sinceIso = new Date(since).toISOString();
  return Promise.all(SURFACES.map(async (s) => ({
    label: s.label,
    supabase: await loadSupabase(s.table, s.column, sinceIso),
    icp: await loadIcp(s.surface, since, until),
  })));
}

const fmt = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

function Cell({ stat }: { stat: Stat | null }) {
  if (!stat) return <span className="text-muted-foreground">Not available</span>;
  if (!stat.count) return <span className="text-muted-foreground">No data yet</span>;
  return (
    <div>
      <div className="font-medium">{fmt(stat.p50)}</div>
      <div className="text-xs text-muted-foreground">slow: {fmt(stat.p95)} · {stat.count} opens</div>
    </div>
  );
}

export function SpeedComparisonCard() {
  const q = useQuery({ queryKey: ["admin-speed-comparison"], queryFn: loadAll, staleTime: 60_000 });
  const icpMissing = q.data?.every((r) => r.icp === null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Speed</CardTitle>
          <CardDescription>
            Real timings from people using the app, last {DAYS} days. Typical time, with the slowest 5% underneath.
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => q.refetch()} aria-label="Refresh speed">
          <RefreshCw className={q.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 pr-2 font-normal">Screen</th>
                  <th className="py-2 pr-2 font-normal">Supabase</th>
                  <th className="py-2 font-normal">Secure sign-in (ICP)</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((r) => (
                  <tr key={r.label} className="border-t border-border align-top">
                    <td className="py-2 pr-2">{r.label}</td>
                    <td className="py-2 pr-2"><Cell stat={r.supabase} /></td>
                    <td className="py-2"><Cell stat={r.icp} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {icpMissing && (
              <p className="mt-3 text-xs text-muted-foreground">
                Secure sign-in timings only show when you're signed in with secure sign-in as an app admin.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Chat open timings recorded before 11 Oct 2026 included time spent elsewhere in the app and read too high.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Note: an earlier side-by-side speed test compared the two backends from a computer in Europe, which unfairly
              made Supabase reads look about 10× slower. From Australia both versions read at very similar speeds — judge
              the columns above, which come from real phones, not that test.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
