import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getActiveIcpTarget } from "@/live/targetRegistry";

type UsageRow = { label: string; value: number | null };

type StatsSpec = {
  canisterKey: string;
  fields: { field: string; label: string }[];
};

// Aggregate record counts per domain canister, via its public usage_stats
// query (counts only — no record contents). Canisters without the method yet
// report null and show "after next deploy".
const STATS: StatsSpec[] = [
  {
    canisterKey: "club_domain",
    fields: [
      { field: "clubs", label: "Clubs" },
      { field: "teams", label: "Teams" },
      { field: "accounts", label: "Member accounts" },
      { field: "news_posts", label: "News posts" },
    ],
  },
  {
    canisterKey: "messaging_domain",
    fields: [
      { field: "conversations", label: "Conversations" },
      { field: "messages", label: "Messages" },
      { field: "scheduled_messages", label: "Scheduled messages" },
    ],
  },
  {
    canisterKey: "events_domain",
    fields: [
      { field: "events", label: "Events" },
      { field: "rsvps", label: "RSVPs" },
      { field: "children", label: "Children" },
    ],
  },
];

async function loadUsage(): Promise<{ rows: UsageRow[]; pending: boolean }> {
  const target = getActiveIcpTarget();
  const [{ HttpAgent, Actor, AnonymousIdentity }, { IDL }] = await Promise.all([
    import("@icp-sdk/core/agent"),
    import("@icp-sdk/core/candid"),
  ]);
  const agent = await HttpAgent.create({ host: target.host, identity: new AnonymousIdentity() });
  const rows: UsageRow[] = [];
  let pending = false;
  await Promise.all(
    STATS.map(async (spec) => {
      const canisterId = target.canisterIds?.[spec.canisterKey];
      const idl = () =>
        IDL.Service({
          usage_stats: IDL.Func([], [IDL.Record(Object.fromEntries(spec.fields.map(f => [f.field, IDL.Nat])))], ["query"]),
        });
      let stats: Record<string, bigint> | null = null;
      if (canisterId) {
        try {
          const actor = Actor.createActor<{ usage_stats: () => Promise<Record<string, bigint>> }>(idl, { agent, canisterId });
          stats = await actor.usage_stats();
        } catch {
          pending = true; // method not deployed yet, or canister unreachable
        }
      } else {
        pending = true;
      }
      for (const f of spec.fields) {
        rows.push({ label: f.label, value: stats ? Number(stats[f.field] ?? 0n) : null });
      }
    }),
  );
  return { rows, pending };
}

/** Aggregate usage counts across the ICP domain canisters, for capacity planning. */
export function CanisterUsageCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-canister-usage"],
    queryFn: loadUsage,
    staleTime: 5 * 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Blockchain usage</CardTitle>
          <CardDescription>
            How much is stored on the blockchain copy. One set of canisters comfortably serves hundreds of active
            clubs — when clubs or messages climb into the thousands, add another ICP Cloud Engine above and point new
            clubs at it.
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh usage">
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Counting…</p>}
        {!isLoading && data?.pending && (
          <p className="text-sm text-muted-foreground">
            Some counts show after the next blockchain deploy.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(data?.rows ?? []).map((row) => (
            <div key={row.label} className="rounded-md border p-2">
              <p className="text-xs text-muted-foreground">{row.label}</p>
              <p className="text-lg font-semibold tabular-nums">
                {row.value === null ? "—" : row.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
