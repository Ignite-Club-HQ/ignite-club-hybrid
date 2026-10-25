import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentInternetIdentity } from "@/live/internetIdentityAuth";
import { tryGetActiveIcpTarget } from "@/live/loadBackendRouting";
import { withFeatureBackend, type FeatureBackendContext } from "@/live/featureRouter";
import { listLiveClubs, listLiveTeams, listLiveNews, listLiveSponsors } from "@/live/features/club";
import { listLiveEvents } from "@/live/features/events";
import { listLiveRoleGrants } from "@/live/features/membership";

/**
 * Read-only on-chain data browser for app admins: the ICP counterpart to the
 * Supabase table editor. Every read runs as the signed-in Internet Identity,
 * so canister access rules still apply.
 */

async function getCtx(): Promise<FeatureBackendContext> {
  const target = tryGetActiveIcpTarget();
  if (!target) throw new Error("No Internet Computer connection is configured.");
  const identity = await getCurrentInternetIdentity().catch(() => null);
  if (!identity) throw new Error("Sign in with Internet Identity to browse on-chain data.");
  return { target, identity } as FeatureBackendContext;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "bigint") {
    // nanosecond timestamps -> readable date
    if (v > 1_000_000_000_000_000_000n) return new Date(Number(v / 1_000_000n)).toLocaleString();
    return v.toString();
  }
  if (Array.isArray(v)) return v.length === 1 && typeof v[0] !== "object" ? fmt(v[0]) : v.length === 0 ? "" : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  if (typeof v === "object") {
    if ("toText" in (v as object) && typeof (v as { toText: unknown }).toText === "function") return (v as { toText: () => string }).toText();
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  }
  return String(v);
}

function DataTable({ rows, filter }: { rows: Record<string, unknown>[]; filter: string }) {
  const cols = useMemo(() => Array.from(new Set(rows.flatMap((r) => Object.keys(r)))), [rows]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? rows.filter((r) => cols.some((c) => fmt(r[c]).toLowerCase().includes(f))) : rows;
  }, [rows, cols, filter]);
  if (!rows.length) return <p className="text-sm text-muted-foreground py-6 text-center">No rows.</p>;
  return (
    <div className="overflow-auto max-h-[60vh] border rounded-md">
      <table className="text-xs w-full">
        <thead className="sticky top-0 bg-muted">
          <tr>{cols.map((c) => <th key={c} className="text-left font-medium px-2 py-1 whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-t">
              {cols.map((c) => <td key={c} className="px-2 py-1 align-top max-w-[260px] truncate" title={fmt(r[c])}>{fmt(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground px-2 py-1">{shown.length} of {rows.length} rows</p>
    </div>
  );
}

function ClubTable({ name, clubId, load, filter }: { name: string; clubId: string; load: (ctx: FeatureBackendContext, id: string) => Promise<unknown[]>; filter: string }) {
  const q = useQuery({
    queryKey: ["admin-icp-data", name, clubId],
    enabled: !!clubId,
    // Read from the group that owns this club (Group 2 clubs refuse on Group 1).
    queryFn: async () => (await withFeatureBackend(name === "events" ? "events" : "membership", {
      supabase: async () => { throw new Error("Sign in with Internet Identity to browse on-chain data."); },
      icp: (ctx) => load(ctx, clubId),
    }, { clubId })) as Record<string, unknown>[],
  });
  if (!clubId) return <p className="text-sm text-muted-foreground py-6 text-center">Pick a club first.</p>;
  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-6" />;
  if (q.error) return <p className="text-sm text-destructive py-4">{(q.error as Error).message}</p>;
  return <DataTable rows={q.data ?? []} filter={filter} />;
}

export default function AdminIcpDataPage() {
  const navigate = useNavigate();
  const [clubId, setClubId] = useState("");
  const [filter, setFilter] = useState("");

  const clubs = useQuery({
    queryKey: ["admin-icp-data", "clubs"],
    queryFn: async () => {
      const ctx = await getCtx();
      const all: Record<string, unknown>[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 20; i++) {
        const page = (await listLiveClubs(ctx, cursor, 100)) as unknown as Record<string, unknown>[] | { items?: Record<string, unknown>[]; next_cursor?: [] | [string] };
        const items = Array.isArray(page) ? page : page.items ?? [];
        all.push(...items);
        const next = Array.isArray(page) ? null : page.next_cursor?.[0] ?? null;
        if (!next || !items.length) break;
        cursor = next;
      }
      return all;
    },
  });

  const tables: { key: string; label: string; load: (ctx: FeatureBackendContext, id: string) => Promise<unknown[]> }[] = [
    { key: "teams", label: "Teams", load: (c, id) => listLiveTeams(c, id) },
    { key: "members", label: "Members & roles", load: (c, id) => listLiveRoleGrants(c, id) as Promise<unknown[]> },
    { key: "events", label: "Events", load: (c, id) => listLiveEvents(c, id) as Promise<unknown[]> },
    { key: "news", label: "News", load: (c, id) => listLiveNews(c, id) as Promise<unknown[]> },
    { key: "sponsors", label: "Sponsors", load: (c, id) => listLiveSponsors(c, id) as Promise<unknown[]> },
  ];

  return (
    <div className="container max-w-6xl py-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}><ArrowLeft className="h-4 w-4 mr-1" />Admin</Button>
      <Card>
        <CardHeader>
          <CardTitle>On-chain data</CardTitle>
          <CardDescription>
            Browse what's stored on your canisters. Read-only. Private details (names, chat, vault) stay encrypted and aren't shown here.
            Cycle balances and memory are in the Canister health report.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="Filter rows…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Button variant="outline" size="icon" onClick={() => clubs.refetch()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>
          <Tabs defaultValue="clubs">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="clubs">Clubs</TabsTrigger>
              {tables.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
            </TabsList>
            <TabsContent value="clubs" className="space-y-2">
              {clubs.isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto my-6" />
                : clubs.error ? <p className="text-sm text-destructive">{(clubs.error as Error).message}</p>
                : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(clubs.data ?? []).map((c) => (
                        <Button key={String(c.id)} size="sm" variant={clubId === c.id ? "default" : "outline"} onClick={() => setClubId(String(c.id))}>
                          {String(c.name ?? c.id)}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Tap a club, then open the other tabs to see its data.</p>
                    <DataTable rows={clubs.data ?? []} filter={filter} />
                  </>
                )}
            </TabsContent>
            {tables.map((t) => (
              <TabsContent key={t.key} value={t.key}>
                <ClubTable name={t.key} clubId={clubId} load={t.load} filter={filter} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
