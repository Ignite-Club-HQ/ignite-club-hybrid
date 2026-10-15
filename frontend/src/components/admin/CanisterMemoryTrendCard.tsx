import { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MemoryReport } from "@/lib/canisterMemoryReports";
import { detectSpikes, memorySeries, type LiveMem } from "./canisterMemoryForecast";

const fmt = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`);
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function CanisterMemoryTrendCard({ live, history }: { live: LiveMem[]; history: MemoryReport[] }) {
  const series = useMemo(() => memorySeries(history, live), [history, live]);
  const spikes = useMemo(() => detectSpikes(series), [series]);
  const spiked = new Set(spikes.map((s) => s.key));
  const keys = Object.keys(series).sort((a, b) => Number(spiked.has(b)) - Number(spiked.has(a)) || a.localeCompare(b));
  const [selected, setSelected] = useState<string | null>(null);
  const key = selected ?? keys[0] ?? null;
  const data = key ? series[key].map((p) => ({ at: p.at, mb: Math.round(p.mb) })) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory over time</CardTitle>
        <CardDescription>
          Readings are saved automatically whenever an admin opens this page (at most every 3 hours), so no health
          run is needed. A jump of 100 MB and 15% or more between readings is flagged as a spike.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {spikes.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4" />No sudden spikes detected.
          </p>
        ) : (
          <div className="space-y-1">
            {spikes.slice(0, 5).map((s) => (
              <p key={s.key + s.at} className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {s.key} jumped {fmt(s.fromMb)} → {fmt(s.toMb)} on {day(s.at)}
              </p>
            ))}
          </div>
        )}
        {keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No readings yet — they appear after the canisters are upgraded.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {keys.map((k) => (
                <button key={k} onClick={() => setSelected(k)}>
                  <Badge variant={k === key ? "default" : spiked.has(k) ? "destructive" : "outline"}>{k}</Badge>
                </button>
              ))}
            </div>
            {data.length < 2 ? (
              <p className="text-xs text-muted-foreground">Only one reading so far — the line appears after the next one.</p>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data}>
                    <XAxis dataKey="at" type="number" domain={["dataMin", "dataMax"]} tickFormatter={day} fontSize={10} />
                    <YAxis tickFormatter={(v) => fmt(v)} fontSize={10} width={60} />
                    <Tooltip labelFormatter={(v) => new Date(v as number).toLocaleString()} formatter={(v) => fmt(v as number)} />
                    <Line dataKey="mb" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
