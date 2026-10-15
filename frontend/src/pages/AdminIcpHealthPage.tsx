import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
 * Memory size is not exposed by the canisters yet, so this page reports
 * cycles only; the GitHub "Canister health" workflow remains the source for
 * memory until a `memory_size` query is deployed.
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
};

const cyclesIdl: IDL.InterfaceFactory = ({ IDL }) =>
  IDL.Service({ cycles_balance: IDL.Func([], [IDL.Nat], ["query"]) });

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
      const actor = Actor.createActor<{ cycles_balance: () => Promise<bigint> }>(cyclesIdl, {
        agent,
        canisterId: Principal.fromText(ids[key]),
      });
      return { key, balance: await actor.cycles_balance() };
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
      };
    }
    return {
      key,
      canisterId: ids[key],
      cyclesT: null,
      burnTPerDay: null,
      daysLeft: null,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

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
            A canister below {LOW_CYCLES_T} trillion cycles (≈ US$1.30) needs a top-up soon. Memory size isn't
            reported on-chain yet; the GitHub Canister health workflow still covers that.
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
                            <td colSpan={3} className="px-2 py-1 text-destructive" title={r.error}>
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
    </div>
  );
}
