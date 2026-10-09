import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getActiveIcpTarget } from "@/live/targetRegistry";

type Balance = { key: string; canisterId: string; cycles: bigint | null; error?: string };

// The web-app (asset) canister serving the blockchain copy of the site. It has
// no cycles_balance query of its own, so its balance is read through
// club_domain's canister_cycles proxy (club_domain is added as a controller by
// the frontend deploy workflow).
const FRONTEND_CANISTER_ID = "proe7-kqaaa-aaaas-qg6gq-cai";

const T = 1_000_000_000_000n;
const LOW = 500_000_000_000n; // 0.5T
const WARN = 2n * T;

function formatCycles(c: bigint): string {
  const whole = Number(c / 10_000_000_000n) / 100; // two decimals in T
  return `${whole.toFixed(2)}T`;
}

// 1T cycles = 1 XDR (fixed by the protocol). XDR→USD drifts; ~1.35 is close enough for an estimate.
const USD_PER_T = 1.35;
const HISTORY_KEY = "admin-canister-cycle-history-v1";
const MIN_SPAN_MS = 6 * 3600_000; // need 6h of history before estimating
type Snap = { t: number; c: string };

/** Records this reading and returns cycles burned per day, from the oldest reading since the last top-up. */
function burnPerDay(canisterId: string, cycles: bigint): number | null {
  try {
    const all: Record<string, Snap[]> = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}");
    let list = (all[canisterId] ?? []).filter((s) => Date.now() - s.t < 30 * 86400_000);
    const last = list[list.length - 1];
    if (last && BigInt(last.c) < cycles) list = []; // topped up: restart the baseline
    if (!last || Date.now() - last.t > 15 * 60_000 || list.length === 0) list.push({ t: Date.now(), c: cycles.toString() });
    all[canisterId] = list.slice(-200);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
    const first = list[0];
    const span = Date.now() - first.t;
    if (span < MIN_SPAN_MS) return null;
    const burned = Number(BigInt(first.c) - cycles);
    return Math.max(0, burned) / (span / 86400_000);
  } catch {
    return null;
  }
}

function usdPerMonth(perDay: number): number {
  return (perDay * 30) / 1e12 * USD_PER_T;
}

async function loadBalances(): Promise<Balance[]> {
  const target = getActiveIcpTarget();
  const entries = Object.entries(target.canisterIds ?? {}).filter(([, id]) => !!id);
  if (entries.length === 0) return [];
  const [{ HttpAgent, Actor, AnonymousIdentity }, { IDL }] = await Promise.all([
    import("@icp-sdk/core/agent"),
    import("@icp-sdk/core/candid"),
  ]);
  const agent = await HttpAgent.create({ host: target.host, identity: new AnonymousIdentity() });
  const idl = () => IDL.Service({ cycles_balance: IDL.Func([], [IDL.Nat], ["query"]) });
  const proxyIdl = () =>
    IDL.Service({ canister_cycles: IDL.Func([IDL.Principal], [IDL.Nat], []) });
  const clubDomainId = target.canisterIds?.["club_domain"];
  const frontendBalance = async (): Promise<Balance> => {
    try {
      if (!clubDomainId) throw new Error("no club_domain");
      const { Principal } = await import("@icp-sdk/core/principal");
      const proxy = Actor.createActor<{ canister_cycles: (id: unknown) => Promise<bigint> }>(proxyIdl, {
        agent,
        canisterId: clubDomainId,
      });
      const cycles = await proxy.canister_cycles(Principal.fromText(FRONTEND_CANISTER_ID));
      return { key: "frontend (web app)", canisterId: FRONTEND_CANISTER_ID, cycles };
    } catch {
      return {
        key: "frontend (web app)",
        canisterId: FRONTEND_CANISTER_ID,
        cycles: null,
        error: "Available after the next backend + web app deploys",
      };
    }
  };
  const balances = await Promise.all(
    entries.map(async ([key, canisterId]): Promise<Balance> => {
      try {
        const actor = Actor.createActor<{ cycles_balance: () => Promise<bigint> }>(idl, { agent, canisterId });
        return { key, canisterId, cycles: await actor.cycles_balance() };
      } catch (error) {
        const text = String(error);
        return {
          key,
          canisterId,
          cycles: null,
          error: /cycles_balance|has no query method|IC0302|IC0536/.test(text)
            ? "Needs the next mainnet deploy to report its balance"
            : /out of cycles|IC0207|frozen/i.test(text)
              ? "Out of cycles — top up now"
              : "Couldn't reach this canister",
        };
      }
    }),
  );
  return [...balances, await frontendBalance()];
}

/** Cycle (credit) balance of every configured canister, read via its public cycles_balance query. */
export function CanisterBalancesCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-canister-balances"],
    queryFn: loadBalances,
    staleTime: 60_000,
  });
  const rates = new Map<string, number | null>();
  for (const b of data ?? []) if (b.cycles !== null) rates.set(b.canisterId, burnPerDay(b.canisterId, b.cycles));
  const known = [...rates.values()].filter((r): r is number => r !== null);
  const totalUsd = known.reduce((sum, r) => sum + usdPerMonth(r), 0);
  const sorted = [...(data ?? [])].sort((a, b) => {
    if (a.cycles === null) return -1;
    if (b.cycles === null) return 1;
    return a.cycles < b.cycles ? -1 : 1;
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Canister balances</CardTitle>
          <CardDescription>
            Cycles left in each canister (lowest first), including the web-app canister. Top up anything under 2T —
            cycle.express sends cycles straight to a canister ID. A canister at zero stops working.
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh balances">
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Checking balances…</p>}
        {!isLoading && sorted.length === 0 && (
          <p className="text-sm text-muted-foreground">No canister IDs configured.</p>
        )}
        {data && data.length > 0 && (
          <div className="rounded-md bg-muted p-2 text-sm">
            {known.length > 0 ? (
              <>
                Estimated running cost: <span className="font-semibold">${totalUsd.toFixed(2)}/month</span>
                {known.length < rates.size && " (some canisters still measuring)"}
              </>
            ) : (
              "Estimated running cost appears after this page has been opened twice, at least 6 hours apart."
            )}
            <p className="text-xs text-muted-foreground">
              Based on cycles burned between your visits to this page (on this device), at about ${USD_PER_T} per 1T
              cycles. Top-ups restart the measurement.
            </p>
          </div>
        )}
        {sorted.map((b) => (
          <div key={b.key} className="flex items-center justify-between gap-3 rounded-md border p-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{b.key}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{b.canisterId}</p>
              {rates.get(b.canisterId) != null && (
                <p className="text-xs text-muted-foreground">
                  ~${usdPerMonth(rates.get(b.canisterId)!).toFixed(2)}/month ·{" "}
                  {formatCycles(BigInt(Math.round(rates.get(b.canisterId)! * 30)))} per 30 days
                  {b.cycles !== null && rates.get(b.canisterId)! > 0 &&
                    ` · lasts ~${Math.floor(Number(b.cycles) / rates.get(b.canisterId)!)} days`}
                </p>
              )}
              {b.error && <p className="text-xs text-muted-foreground">{b.error}</p>}
            </div>
            {b.cycles !== null ? (
              <Badge variant={b.cycles < LOW ? "destructive" : b.cycles < WARN ? "secondary" : "outline"}>
                {formatCycles(b.cycles)}
              </Badge>
            ) : (
              <Badge variant="outline">—</Badge>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
