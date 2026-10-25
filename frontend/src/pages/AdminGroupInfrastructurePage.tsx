import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Actor, HttpAgent, AnonymousIdentity } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import { ArrowLeft, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { ROUTING_GATES_SNAPSHOT } from "@/live/generated/routingGates";
import { DEPLOYED_MAINNET_CANISTER_IDS } from "@/live/generated/deployedCanisterIds";
import { GROUP_TESTED_LIMITS } from "@/live/groupTestedLimits";
import {
  buildGroupSpecs,
  computeGroupRollup,
  formatBytes,
  formatT,
  LOW_FUEL_T,
  WARN_MEMORY_MB,
  type CanisterReading,
  type GroupSpec,
  type PhotoStoreReading,
} from "@/live/groupUtilization";
import { listMemoryReports, addManualMemoryReading, type MemoryReading } from "@/lib/canisterMemoryReports";
import { CanisterMemoryTrendCard } from "@/components/admin/CanisterMemoryTrendCard";
import { CanisterMemoryForecastCard } from "@/components/admin/CanisterMemoryForecastCard";

/**
 * Group Infrastructure — the single canonical live-utilization view.
 *
 * Shows every router group (from the governor-verified routing snapshot) plus
 * the shared "Group 1" deployment: per-group and per-canister memory against
 * tested limits, fuel levels, club counts and photo-store fullness, polled
 * live every 30 seconds. Read-only by design: adding, opening or stopping a
 * group needs the deploy key and stays in the GitHub workflows.
 *
 * Canister Health and Placement Settings no longer show their own fuel/memory
 * cards — they link here instead, so this information lives in exactly one
 * place.
 */

const REFRESH_MS = 30_000;
// The web-app (asset) canister has no cycles_balance query of its own, so its
// balance is read through club_domain's canister_cycles proxy.
const FRONTEND_CANISTER_ID = "proe7-kqaaa-aaaas-qg6gq-cai";

const statsIdl: IDL.InterfaceFactory = ({ IDL }) =>
  IDL.Service({
    cycles_balance: IDL.Func([], [IDL.Nat], ["query"]),
    memory_stats: IDL.Func(
      [],
      [IDL.Record({ heap_bytes: IDL.Nat, memory_bytes: IDL.Nat, stable_bytes: IDL.Nat })],
      ["query"],
    ),
  });
const usageIdl: IDL.InterfaceFactory = ({ IDL }) =>
  IDL.Service({
    usage_stats: IDL.Func([], [IDL.Record({ clubs: IDL.Nat })], ["query"]),
  });
const storeUsageIdl: IDL.InterfaceFactory = ({ IDL }) =>
  IDL.Service({
    get_usage: IDL.Func(
      [],
      [IDL.Record({ total_bytes: IDL.Nat64, capacity_limit_bytes: IDL.Nat64, accepting_uploads: IDL.Bool })],
      ["query"],
    ),
  });
const proxyIdl: IDL.InterfaceFactory = ({ IDL }) =>
  IDL.Service({ canister_cycles: IDL.Func([IDL.Principal], [IDL.Nat], []) });

type FetchResult = {
  readings: Map<string, CanisterReading>; // keyed by canisterId
  photoStores: Map<string, PhotoStoreReading>; // keyed by canisterId
  frontendCyclesT: number | null;
};

async function fetchUtilization(groups: GroupSpec[], globalCanisters: { key: string; canisterId: string }[]): Promise<FetchResult> {
  const host = ROUTING_GATES_SNAPSHOT?.host ?? "https://icp-api.io";
  const agent = await HttpAgent.create({
    host,
    identity: new AnonymousIdentity(),
    shouldSyncTime: true,
    retryTimes: 1,
  });

  const all = [...groups.flatMap((g) => g.canisters), ...globalCanisters];
  const unique = [...new Map(all.map((c) => [c.canisterId, c])).values()];

  const readings = new Map<string, CanisterReading>();
  // Each canister gets a short deadline so one slow service can't hold the page.
  const within = <V,>(p: Promise<V>) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("No answer in time")), 10_000))]);
  const fuelAndMemory = Promise.allSettled(
    unique.map(async (c) => {
      try {
        const actor = Actor.createActor<{
          cycles_balance: () => Promise<bigint>;
          memory_stats: () => Promise<{ heap_bytes: bigint; memory_bytes: bigint; stable_bytes: bigint }>;
        }>(statsIdl, { agent, canisterId: Principal.fromText(c.canisterId) });
        const [balance, mem] = await Promise.all([within(actor.cycles_balance()), within(actor.memory_stats()).catch(() => null)]);
        readings.set(c.canisterId, {
          key: c.key,
          canisterId: c.canisterId,
          memoryBytes: mem ? Number(mem.memory_bytes) : null,
          cyclesT: Number(balance) / 1e12,
          clubs: null,
          error: null,
        });
      } catch (e) {
        readings.set(c.canisterId, {
          key: c.key,
          canisterId: c.canisterId,
          memoryBytes: null,
          cyclesT: null,
          clubs: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  // Club counts from each group's club_domain (public counts, no PII).
  const clubCounts = new Map<string, number>();
  const clubCountReads = Promise.allSettled(
    groups.map(async (g) => {
      const club = g.canisters.find((c) => c.key === "club_domain");
      if (!club) return;
      try {
        const actor = Actor.createActor<{ usage_stats: () => Promise<{ clubs: bigint }> }>(usageIdl, {
          agent,
          canisterId: Principal.fromText(club.canisterId),
        });
        const stats = await within(actor.usage_stats());
        clubCounts.set(club.canisterId, Number(stats.clubs));
      } catch {
        // Club count stays unknown; the row still shows memory and fuel.
      }
    }),
  );

  // Photo stores: one per group, queried directly by canister ID.
  const photoStores = new Map<string, PhotoStoreReading>();
  const photoReads = Promise.allSettled(
    groups
      .filter((g) => g.photoStoreId)
      .map(async (g) => {
        const id = g.photoStoreId!;
        try {
          const actor = Actor.createActor<{
            get_usage: () => Promise<{ total_bytes: bigint; capacity_limit_bytes: bigint; accepting_uploads: boolean }>;
          }>(storeUsageIdl, { agent, canisterId: Principal.fromText(id) });
          const usage = await within(actor.get_usage());
          photoStores.set(id, {
            totalBytes: Number(usage.total_bytes),
            limitBytes: Number(usage.capacity_limit_bytes),
            accepting: usage.accepting_uploads,
            error: null,
          });
        } catch (e) {
          photoStores.set(id, { totalBytes: 0, limitBytes: 0, accepting: true, error: e instanceof Error ? e.message : String(e) });
        }
      }),
  );

  // Web-app canister fuel via the shared club_domain proxy.
  let frontendCyclesT: number | null = null;
  const sharedClubDomain = DEPLOYED_MAINNET_CANISTER_IDS["club_domain"];
  const frontendRead = (async () => { if (sharedClubDomain) {
    try {
      const proxy = Actor.createActor<{ canister_cycles: (id: Principal) => Promise<bigint> }>(proxyIdl, {
        agent,
        canisterId: Principal.fromText(sharedClubDomain),
      });
      frontendCyclesT = Number(await within(proxy.canister_cycles(Principal.fromText(FRONTEND_CANISTER_ID)))) / 1e12;
    } catch {
      frontendCyclesT = null;
    }
  } })();

  // All four kinds of reading run at the same time instead of one after another.
  await Promise.all([fuelAndMemory, clubCountReads, photoReads, frontendRead]);
  for (const [id, clubs] of clubCounts) { const row = readings.get(id); if (row) row.clubs = clubs; }

  return { readings, photoStores, frontendCyclesT };
}

export default function AdminGroupInfrastructurePage() {
  const { isAppAdmin, isLoading: adminLoading } = useIsAppAdmin();
  if (adminLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-10" />;
  if (!isAppAdmin) return <p className="text-sm text-muted-foreground text-center py-10">App admins only.</p>;
  return <GroupInfrastructureContent />;
}

function GroupInfrastructureContent() {
  const navigate = useNavigate();
  const { groups, globalCanisters } = useMemo(
    () =>
      buildGroupSpecs({
        snapshot: ROUTING_GATES_SNAPSHOT ?? null,
        sharedCanisterIds: DEPLOYED_MAINNET_CANISTER_IDS,
        testedLimits: GROUP_TESTED_LIMITS,
      }),
    [],
  );

  const q = useQuery({
    queryKey: ["admin-group-infrastructure"],
    queryFn: () => fetchUtilization(groups, globalCanisters),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS / 2,
  });

  // Keep the memory history growing so the trend/forecast cards below keep
  // working (this used to happen on the old Canister Health page).
  const qc = useQueryClient();
  const reports = useQuery({ queryKey: ["canister-memory-reports"], queryFn: () => listMemoryReports(200) });
  const autoSaved = useRef(false);
  useEffect(() => {
    if (autoSaved.current || !reports.isSuccess || !q.data) return;
    const readings = [...q.data.readings.values()]
      .filter((r) => r.memoryBytes != null)
      .map((r) => ({ name: r.key, memory_mb: Math.round(r.memoryBytes! / 1e6), cycles_t: r.cyclesT ?? undefined }));
    if (!readings.length) return;
    autoSaved.current = true;
    const latest = Math.max(0, ...(reports.data ?? []).map((r) => Date.parse(r.at) || 0));
    if (Date.now() - latest < 3 * 60 * 60 * 1000) return;
    addManualMemoryReading(readings, "auto")
      .then(() => qc.invalidateQueries({ queryKey: ["canister-memory-reports"] }))
      .catch(() => {});
  }, [q.data, reports.isSuccess, reports.data, qc]);

  const liveRows = useMemo(
    () =>
      [...(q.data?.readings.values() ?? [])]
        .filter((r) => r.memoryBytes != null)
        .map((r) => ({ key: r.key, mb: r.memoryBytes! / 1e6 })),
    [q.data],
  );

  return (
    <div className="container max-w-4xl py-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
        <ArrowLeft className="h-4 w-4 mr-1" />Admin
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />Group infrastructure
          </CardTitle>
          <CardDescription>
            Live memory, fuel and club counts for every group, read straight from the Internet Computer and
            refreshed every 30 seconds. Read-only: adding, opening or stopping a group uses the GitHub workflows
            (they hold the deploy key — the app never can).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Refresh
            </Button>
            {q.dataUpdatedAt > 0 && (
              <span className="text-xs text-muted-foreground">Updated {new Date(q.dataUpdatedAt).toLocaleTimeString()}</span>
            )}
          </div>
          {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
        </CardContent>
      </Card>

      {q.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin mx-auto my-6" />
      ) : (
        <>
          {groups.map((g) => (
            <GroupCard key={g.id} spec={g} data={q.data} />
          ))}
          <GlobalServicesCard canisters={globalCanisters} data={q.data} frontendCyclesT={q.data?.frontendCyclesT ?? null} />
        </>
      )}

      {liveRows.length > 0 && (
        <>
          <CanisterMemoryTrendCard live={liveRows} history={reports.data ?? []} />
          <CanisterMemoryForecastCard live={liveRows} history={reports.data ?? []} />
        </>
      )}
      <MemoryReportsCard liveRows={liveRows} />
    </div>
  );
}

function GroupCard({ spec, data }: { spec: GroupSpec; data: FetchResult | undefined }) {
  const readings = spec.canisters
    .map((c) => data?.readings.get(c.canisterId))
    .filter((r): r is CanisterReading => !!r);
  const rollup = computeGroupRollup(readings, spec);
  const clubs = readings.find((r) => r.key === "club_domain")?.clubs ?? null;
  const store = spec.photoStoreId ? data?.photoStores.get(spec.photoStoreId) : undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{spec.label}</CardTitle>
          <div className="flex items-center gap-2">
            {spec.accepting === true && <Badge variant="secondary">Open to new clubs</Badge>}
            {spec.accepting === false && <Badge variant="outline">Closed to new clubs</Badge>}
            {clubs != null && (
              <Badge variant="outline">
                {clubs} club{clubs === 1 ? "" : "s"}
                {spec.maxClubs != null ? ` / ${spec.maxClubs} max` : ""}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>
          {rollup.unreadable.length > 0 ? (
            <span className="text-destructive">Couldn't read: {rollup.unreadable.join(", ")}</span>
          ) : (
            "All services reporting."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">Memory (all services)</p>
            <p className="text-sm font-medium">{formatBytes(rollup.memoryBytes)}</p>
            {rollup.memoryPct != null && rollup.testedLimitBytes != null ? (
              <>
                <Progress value={Math.min(100, rollup.memoryPct)} />
                <p className="text-xs text-muted-foreground">
                  {rollup.memoryPct.toFixed(1)}% of the {formatBytes(rollup.testedLimitBytes)} tested limit
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No tested limit recorded for this group yet.</p>
            )}
          </div>
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">Lowest fuel</p>
            <p className={`text-sm font-medium ${rollup.minCyclesT != null && rollup.minCyclesT < LOW_FUEL_T ? "text-destructive" : ""}`}>
              {rollup.minCyclesT != null ? `${formatT(rollup.minCyclesT)}T cycles` : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Below {LOW_FUEL_T}T needs a top-up (GitHub → Top up canister cycles).
            </p>
          </div>
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">Photo store</p>
            {store && !store.error ? (
              <>
                <p className="text-sm font-medium">
                  {formatBytes(store.totalBytes)} of {formatBytes(store.limitBytes)}
                </p>
                <Progress value={store.limitBytes > 0 ? Math.min(100, (store.totalBytes / store.limitBytes) * 100) : 0} />
                <p className="text-xs text-muted-foreground">
                  {store.accepting ? "Accepting photos" : "Full — read only"}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{store?.error ? "Couldn't read the store." : "No photo store."}</p>
            )}
          </div>
        </div>

        <div className="overflow-auto border rounded-md">
          <table className="text-xs w-full">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left font-medium px-2 py-1">Canister</th>
                <th className="text-left font-medium px-2 py-1">ID</th>
                <th className="text-right font-medium px-2 py-1">Memory</th>
                <th className="text-right font-medium px-2 py-1">% of limit</th>
                <th className="text-right font-medium px-2 py-1">Fuel (T)</th>
              </tr>
            </thead>
            <tbody>
              {spec.canisters.map((c) => {
                const r = data?.readings.get(c.canisterId);
                const limit = spec.testedLimitBytes[c.key];
                const memMb = r?.memoryBytes != null ? r.memoryBytes / 1e6 : null;
                const pct = r?.memoryBytes != null && limit > 0 ? (r.memoryBytes / limit) * 100 : null;
                const lowFuel = r?.cyclesT != null && r.cyclesT < LOW_FUEL_T;
                const highMem = pct != null ? pct >= 80 : memMb != null && memMb > WARN_MEMORY_MB;
                return (
                  <tr key={c.key} className="border-t">
                    <td className="px-2 py-1 font-medium">{c.key}</td>
                    <td className="px-2 py-1 text-muted-foreground">{c.canisterId}</td>
                    {!r || r.error ? (
                      <td colSpan={3} className="px-2 py-1 text-destructive" title={r?.error ?? undefined}>
                        unreadable
                      </td>
                    ) : (
                      <>
                        <td className={`px-2 py-1 text-right ${highMem ? "text-destructive font-medium" : ""}`}>
                          {formatBytes(r.memoryBytes!)}
                        </td>
                        <td className={`px-2 py-1 text-right ${pct != null && pct >= 80 ? "text-destructive font-medium" : ""}`}>
                          {pct != null ? `${pct.toFixed(1)}%` : "—"}
                        </td>
                        <td className={`px-2 py-1 text-right ${lowFuel ? "text-destructive font-medium" : ""}`}>
                          {r.cyclesT != null ? formatT(r.cyclesT) : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function GlobalServicesCard({
  canisters,
  data,
  frontendCyclesT,
}: {
  canisters: { key: string; canisterId: string }[];
  data: FetchResult | undefined;
  frontendCyclesT: number | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Global services</CardTitle>
        <CardDescription>
          Shared control-plane canisters that serve every group, plus the web-app canister that serves this site.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto border rounded-md">
          <table className="text-xs w-full">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left font-medium px-2 py-1">Canister</th>
                <th className="text-left font-medium px-2 py-1">ID</th>
                <th className="text-right font-medium px-2 py-1">Memory</th>
                <th className="text-right font-medium px-2 py-1">Fuel (T)</th>
              </tr>
            </thead>
            <tbody>
              {canisters.map((c) => {
                const r = data?.readings.get(c.canisterId);
                const lowFuel = r?.cyclesT != null && r.cyclesT < LOW_FUEL_T;
                return (
                  <tr key={c.key} className="border-t">
                    <td className="px-2 py-1 font-medium">{c.key}</td>
                    <td className="px-2 py-1 text-muted-foreground">{c.canisterId}</td>
                    {!r || r.error ? (
                      <td colSpan={2} className="px-2 py-1 text-destructive" title={r?.error ?? undefined}>
                        unreadable
                      </td>
                    ) : (
                      <>
                        <td className="px-2 py-1 text-right">{r.memoryBytes != null ? formatBytes(r.memoryBytes) : "—"}</td>
                        <td className={`px-2 py-1 text-right ${lowFuel ? "text-destructive font-medium" : ""}`}>
                          {r.cyclesT != null ? formatT(r.cyclesT) : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              <tr className="border-t">
                <td className="px-2 py-1 font-medium">frontend (web app)</td>
                <td className="px-2 py-1 text-muted-foreground">{FRONTEND_CANISTER_ID}</td>
                <td className="px-2 py-1 text-right">—</td>
                <td className={`px-2 py-1 text-right ${frontendCyclesT != null && frontendCyclesT < LOW_FUEL_T ? "text-destructive font-medium" : ""}`}>
                  {frontendCyclesT != null ? formatT(frontendCyclesT) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function fmtMb(v: number | null): string {
  if (v === null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)} GB` : `${Math.round(v)} MB`;
}

function MemoryReportsCard({ liveRows }: { liveRows: { key: string; mb: number }[] }) {
  const qc = useQueryClient();
  const reports = useQuery({ queryKey: ["canister-memory-reports"], queryFn: () => listMemoryReports(200) });
  const [name, setName] = useState("");
  const [mb, setMb] = useState("");
  const [note, setNote] = useState("");
  const add = useMutation({
    mutationFn: (readings: MemoryReading[]) => addManualMemoryReading(readings),
    onSuccess: () => {
      toast.success("Reading saved.");
      setMb("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["canister-memory-reports"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const liveReadings: MemoryReading[] = liveRows.map((r) => ({ name: r.key, memory_mb: Math.round(r.mb) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory readings history</CardTitle>
        <CardDescription>
          Saved snapshots of canister memory, so you can spot growth over time. Anything over 3 GB needs attention —
          the ceiling is 4 GB.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reports.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        ) : reports.error ? (
          <p className="text-sm text-destructive">{(reports.error as Error).message}</p>
        ) : null}

        <div className="border-t pt-3 space-y-2">
          <p className="text-sm font-medium">Add a reading</p>
          <Button
            variant="outline"
            size="sm"
            disabled={!liveReadings.length || add.isPending}
            onClick={() => add.mutate(liveReadings)}
          >
            Save all live readings now
          </Button>
          <div className="flex flex-wrap gap-2 items-end">
            <Input className="w-44" placeholder="Canister (e.g. media_blob_store)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input className="w-28" type="number" placeholder="Memory MB" value={mb} onChange={(e) => setMb(e.target.value)} />
            <Input className="flex-1 min-w-32" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button
              size="sm"
              disabled={!name.trim() || !(Number(mb) >= 0) || mb === "" || add.isPending}
              onClick={() => add.mutate([{ name: name.trim(), memory_mb: Number(mb), note: note.trim() || undefined }])}
            >
              Save
            </Button>
          </div>
        </div>

        {!!reports.data?.length && (
          <div className="border-t pt-3">
            <p className="text-sm font-medium mb-1">History</p>
            <ul className="text-xs space-y-1 max-h-64 overflow-auto">
              {reports.data.slice(0, 20).map((r, i) => (
                <li key={i} className="text-muted-foreground">
                  {new Date(r.at).toLocaleString()} · {r.source === "manual" ? "added by admin" : "weekly check"} ·{" "}
                  {r.readings.slice(0, 4).map((x) => `${x.name} ${fmtMb(x.memory_mb)}`).join(", ")}
                  {r.readings.length > 4 ? ` +${r.readings.length - 4} more` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
