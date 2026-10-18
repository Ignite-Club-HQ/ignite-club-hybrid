import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { listMemoryReports, addManualMemoryReading, type MemoryReading } from "@/lib/canisterMemoryReports";
import { CanisterMemoryTrendCard } from "@/components/admin/CanisterMemoryTrendCard";
import { CanisterMemoryForecastCard } from "@/components/admin/CanisterMemoryForecastCard";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Actor, HttpAgent, AnonymousIdentity } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import { ArrowLeft, Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { tryGetActiveIcpTarget } from "@/live/loadBackendRouting";
import { DEPLOYED_MAINNET_CANISTER_IDS } from "@/live/generated/deployedCanisterIds";

/**
 * In-app canister health report: the ICP counterpart to Supabase's database
 * size / billing panels. Reads each canister's public `cycles_balance` query
 * (no sign-in needed — it reveals nothing private) and estimates burn rate
 * from snapshots kept on this device.
 *
 * Memory comes live from each canister's public `memory_stats` query, and
 * saved readings build a history so growth is visible over time.
 */

const LOW_CYCLES_T = 1; // warn below 1 trillion cycles (≈ US$1.30)
const SNAPSHOT_KEY = "icp-canister-health-snapshots";
const MAX_SNAPSHOTS = 60;

type Snapshot = { at: number; balances: Record<string, string> }; // bigint as string

type Row = {
  key: string;
  canisterId: string;
  cyclesT: number | null; // trillions
  burnTPerDay: number | null;
  daysLeft: number | null;
  error: string | null;
  memoryMb: number | null; // null until the memory_stats deploy lands
};

const cyclesIdl: IDL.InterfaceFactory = ({ IDL }) =>
  IDL.Service({
    cycles_balance: IDL.Func([], [IDL.Nat], ["query"]),
    memory_stats: IDL.Func([], [IDL.Record({ heap_bytes: IDL.Nat, memory_bytes: IDL.Nat, stable_bytes: IDL.Nat })], ["query"]),
  });
// The web-app (asset) canister has no cycles_balance query of its own, so its
// balance is read through club_domain's canister_cycles proxy (club_domain is
// added as a controller by the frontend deploy workflow).
const FRONTEND_CANISTER_ID = "proe7-kqaaa-aaaas-qg6gq-cai";
const proxyIdl: IDL.InterfaceFactory = ({ IDL }) =>
  IDL.Service({ canister_cycles: IDL.Func([IDL.Principal], [IDL.Nat], []) });
type MemStats = { heap_bytes: bigint; memory_bytes: bigint; stable_bytes: bigint };
const WARN_MEMORY_MB = 3000;

function loadSnapshots(): Snapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Snapshot[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSnapshot(balances: Record<string, bigint>): void {
  try {
    const snapshots = loadSnapshots();
    const entry: Snapshot = {
      at: Date.now(),
      balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, v.toString()])),
    };
    // Skip if the last snapshot is less than an hour old — keeps burn
    // estimates meaningful without flooding storage.
    const last = snapshots[snapshots.length - 1];
    if (last && entry.at - last.at < 60 * 60 * 1000) return;
    snapshots.push(entry);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(-MAX_SNAPSHOTS)));
  } catch {
    // Storage full/blocked — health page still works, just without burn estimates.
  }
}

/** Oldest snapshot at least 12h old, so the burn window is meaningful. */
function baselineSnapshot(): Snapshot | null {
  const snapshots = loadSnapshots();
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  const oldEnough = snapshots.filter((s) => s.at <= cutoff);
  return oldEnough.length ? oldEnough[0] : null;
}

async function fetchHealth(): Promise<Row[]> {
  const target = tryGetActiveIcpTarget();
  const host = target?.host ?? "https://icp0.io";
  const ids = { ...DEPLOYED_MAINNET_CANISTER_IDS, ...(target?.canisterIds ?? {}) };
  const agent = await HttpAgent.create({
    host,
    identity: new AnonymousIdentity(),
    shouldSyncTime: true,
    retryTimes: 1,
  });

  const keys = Object.keys(ids).sort();
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const actor = Actor.createActor<{ cycles_balance: () => Promise<bigint>; memory_stats: () => Promise<MemStats> }>(cyclesIdl, {
        agent,
        canisterId: Principal.fromText(ids[key]),
      });
      const [balance, mem] = await Promise.all([actor.cycles_balance(), actor.memory_stats().catch(() => null)]);
      return { key, balance, memoryMb: mem ? Number(mem.memory_bytes) / 1e6 : null };
    }),
  );

  const balances: Record<string, bigint> = {};
  const rows: Row[] = results.map((r, i) => {
    const key = keys[i];
    if (r.status === "fulfilled") {
      balances[key] = r.value.balance;
      return {
        key,
        canisterId: ids[key],
        cyclesT: Number(r.value.balance) / 1e12,
        burnTPerDay: null,
        daysLeft: null,
        error: null,
        memoryMb: r.value.memoryMb,
      };
    }
    return {
      key,
      canisterId: ids[key],
      cyclesT: null,
      burnTPerDay: null,
      daysLeft: null,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      memoryMb: null,
    };
  });

  // Web-app canister via the club_domain proxy (never in the mainnet ID table).
  const clubDomainId = ids["club_domain"];
  if (clubDomainId) {
    try {
      const proxy = Actor.createActor<{ canister_cycles: (id: Principal) => Promise<bigint> }>(proxyIdl, {
        agent,
        canisterId: Principal.fromText(clubDomainId),
      });
      const balance = await proxy.canister_cycles(Principal.fromText(FRONTEND_CANISTER_ID));
      balances["frontend"] = balance;
      rows.push({
        key: "frontend (web app)",
        canisterId: FRONTEND_CANISTER_ID,
        cyclesT: Number(balance) / 1e12,
        burnTPerDay: null,
        daysLeft: null,
        error: null,
        memoryMb: null,
      });
    } catch (e) {
      rows.push({
        key: "frontend (web app)",
        canisterId: FRONTEND_CANISTER_ID,
        cyclesT: null,
        burnTPerDay: null,
        daysLeft: null,
        error: e instanceof Error ? e.message : String(e),
        memoryMb: null,
      });
    }
  }

  // Burn estimate from the oldest snapshot at least 12h old.
  const baseline = baselineSnapshot();
  if (baseline) {
    const days = (Date.now() - baseline.at) / (24 * 60 * 60 * 1000);
    for (const row of rows) {
      const before = baseline.balances[row.key];
      if (before === undefined || row.cyclesT === null) continue;
      const burn = (Number(BigInt(before)) / 1e12 - row.cyclesT) / days;
      if (burn > 0.0001) {
        row.burnTPerDay = burn;
        row.daysLeft = row.cyclesT / burn;
      }
    }
  }
  saveSnapshot(balances);
  return rows;
}

function fmtT(v: number): string {
  return v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

function fmtDays(v: number): string {
  if (v >= 365) return ">1 year";
  if (v >= 1) return `~${Math.round(v)} days`;
  return "<1 day";
}

export default function AdminIcpHealthPage() {
  const { isAppAdmin, isLoading: adminLoading } = useIsAppAdmin();
  if (adminLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-10" />;
  if (!isAppAdmin) return <p className="text-sm text-muted-foreground text-center py-10">App admins only.</p>;
  return <HealthContent />;
}

function HealthContent() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["admin-icp-health"], queryFn: fetchHealth, staleTime: 5 * 60 * 1000 });

  const rows = q.data ?? [];
  const lowCount = useMemo(() => rows.filter((r) => r.cyclesT !== null && r.cyclesT < LOW_CYCLES_T).length, [rows]);
  const hasBurn = rows.some((r) => r.burnTPerDay !== null);

  return (
    <div className="container max-w-4xl py-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
        <ArrowLeft className="h-4 w-4 mr-1" />Admin
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Canister health</CardTitle>
          <CardDescription>
            Live cycle balances for every canister, read straight from the Internet Computer — no workflow needed.
            A canister below {LOW_CYCLES_T} trillion cycles (≈ US$1.30) needs a top-up soon. Memory is live too;
            each canister's ceiling is 4 GB, and over 3 GB is flagged.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Refresh
            </Button>
            {q.dataUpdatedAt > 0 && (
              <span className="text-xs text-muted-foreground">
                Updated {new Date(q.dataUpdatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {q.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin mx-auto my-6" />
          ) : q.error ? (
            <p className="text-sm text-destructive py-4">{(q.error as Error).message}</p>
          ) : (
            <>
              {lowCount > 0 ? (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  {lowCount} canister{lowCount === 1 ? "" : "s"} below {LOW_CYCLES_T}T cycles — top up via
                  GitHub Actions → Top up canister cycles.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  All canisters above {LOW_CYCLES_T}T cycles.
                </p>
              )}
              {!hasBurn && (
                <p className="text-xs text-muted-foreground">
                  Burn-rate and days-remaining estimates appear after this page has been opened on this device on
                  two different days.
                </p>
              )}
              <div className="overflow-auto border rounded-md">
                <table className="text-xs w-full">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="text-left font-medium px-2 py-1">Canister</th>
                      <th className="text-left font-medium px-2 py-1">ID</th>
                      <th className="text-right font-medium px-2 py-1">Cycles (T)</th>
                      <th className="text-right font-medium px-2 py-1">Burn/day</th>
                      <th className="text-right font-medium px-2 py-1">Days left</th>
                      <th className="text-right font-medium px-2 py-1">Memory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const low = r.cyclesT !== null && r.cyclesT < LOW_CYCLES_T;
                      return (
                        <tr key={r.key} className="border-t">
                          <td className={`px-2 py-1 font-medium ${low ? "text-destructive" : ""}`}>{r.key}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.canisterId}</td>
                          {r.error ? (
                            <td colSpan={4} className="px-2 py-1 text-destructive" title={r.error}>
                              unreadable
                            </td>
                          ) : (
                            <>
                              <td className={`px-2 py-1 text-right ${low ? "text-destructive font-medium" : ""}`}>
                                {fmtT(r.cyclesT!)}
                              </td>
                              <td className="px-2 py-1 text-right">
                                {r.burnTPerDay !== null ? `${r.burnTPerDay.toFixed(3)}T` : "—"}
                              </td>
                              <td className={`px-2 py-1 text-right ${r.daysLeft !== null && r.daysLeft < 14 ? "text-destructive font-medium" : ""}`}>
                                {r.daysLeft !== null ? fmtDays(r.daysLeft) : "—"}
                              </td>
                              <td className={`px-2 py-1 text-right ${r.memoryMb !== null && r.memoryMb > WARN_MEMORY_MB ? "text-destructive font-medium" : ""}`}>
                                {fmtMb(r.memoryMb)}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <ForecastSection rows={rows} />
      <MemoryReportsCard liveRows={rows} />
    </div>
  );
}

function ForecastSection({ rows }: { rows: Row[] }) {
  const qc = useQueryClient();
  const reports = useQuery({ queryKey: ["canister-memory-reports"], queryFn: () => listMemoryReports(200) });
  // Auto-record live readings (throttled to every 3h) so history builds without a workflow run.
  const autoSaved = useRef(false);
  useEffect(() => {
    if (autoSaved.current || !reports.isSuccess) return;
    const readings = rows.filter((r) => r.memoryMb !== null).map((r) => ({ name: r.key, memory_mb: Math.round(r.memoryMb!), cycles_t: r.cyclesT }));
    if (!readings.length) return;
    autoSaved.current = true;
    const latest = Math.max(0, ...(reports.data ?? []).map((r) => Date.parse(r.at) || 0));
    if (Date.now() - latest < 3 * 60 * 60 * 1000) return;
    addManualMemoryReading(readings, "auto")
      .then(() => qc.invalidateQueries({ queryKey: ["canister-memory-reports"] }))
      .catch(() => {});
  }, [rows, reports.isSuccess, reports.data, qc]);
  if (!rows.length) return null;
  return (
    <>
      <CanisterMemoryTrendCard live={rows} history={reports.data ?? []} />
      <CanisterMemoryForecastCard live={rows} history={reports.data ?? []} />
    </>
  );
}

function fmtMb(v: number | null): string {
  if (v === null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)} GB` : `${Math.round(v)} MB`;
}

function MemoryReportsCard({ liveRows }: { liveRows: Row[] }) {
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
  const liveReadings: MemoryReading[] = liveRows
    .filter((r) => r.memoryMb !== null)
    .map((r) => ({ name: r.key, memory_mb: Math.round(r.memoryMb!), cycles_t: r.cyclesT }));

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
