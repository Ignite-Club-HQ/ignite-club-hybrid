import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { isIcpSession } from "@/lib/icpClubTeamLookup";
import type { LiveClubSubscription } from "@/live/features/club";

type ClubRow = { id: string; name: string; pro: boolean };

async function loadClubs(): Promise<ClubRow[]> {
  const [{ withFeatureBackend }, { connectLiveClubDomain }, { unwrapCandid }] = await Promise.all([
    import("@/live/featureRouter"),
    import("@/live/domains"),
    import("@/live/features/candid"),
  ]);
  return withFeatureBackend("membership", {
    supabase: async () => [],
    icp: async (ctx) => {
      const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
      const clubs = await unwrapCandid(actor.list_clubs([], 100), "List clubs");
      const live = clubs.filter((c) => c.deleted_at_ms.length === 0);
      const subs = await unwrapCandid(
        actor.get_club_subscriptions(live.map((c) => c.id)),
        "Get club subscriptions",
      );
      const byClub = new Map(subs.map((s) => [s.club_id, s]));
      return live.map((c) => {
        const s = byClub.get(c.id);
        return { id: c.id, name: c.name, pro: Boolean(s?.is_pro || s?.admin_pro_override) };
      });
    },
  });
}

function blankSubscription(clubId: string): LiveClubSubscription {
  return {
    club_id: clubId,
    plan: "pro",
    is_pro: false,
    is_pro_football: false,
    is_trial: false,
    admin_pro_override: false,
    admin_pro_football_override: false,
    activated_at_ms: [],
    expires_at_ms: [],
    cancelled_at_ms: [],
    trial_ends_at_ms: [],
    team_limit: [],
  };
}

/** App-admin tool: grant or revoke Pro on blockchain (ICP) clubs. */
export function ClubProOverridesCard() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-icp-club-pro"],
    queryFn: loadClubs,
    staleTime: 30_000,
  });

  if (!isIcpSession()) return null;

  const setPro = async (club: ClubRow, pro: boolean) => {
    setBusyId(club.id);
    try {
      const [{ withFeatureBackend }, { getLiveClubSubscription, saveLiveClubSubscription }] =
        await Promise.all([import("@/live/featureRouter"), import("@/live/features/club")]);
      await withFeatureBackend("membership", {
        supabase: async () => {
          throw new Error("Email sign-in manages Pro from Supabase, not here.");
        },
        icp: async (ctx) => {
          const existing = await getLiveClubSubscription(ctx, club.id);
          const base = existing ?? blankSubscription(club.id);
          await saveLiveClubSubscription(ctx, {
            ...base,
            is_pro: pro,
            admin_pro_override: pro,
            activated_at_ms: pro && base.activated_at_ms.length === 0 ? [BigInt(Date.now())] : base.activated_at_ms,
          });
        },
      });
      qc.invalidateQueries();
      toast.success(`${club.name}: Pro ${pro ? "on" : "off"} — desktop unlocked`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change Pro status");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Club Pro (blockchain)</CardTitle>
          <CardDescription>
            Every club on the blockchain backend. Turning Pro on unlocks desktop access and Pro
            features for that club. Platform admins only — the canister rejects anyone else.
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh clubs">
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading clubs…</p>}
        {!isLoading && (data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No clubs on the blockchain backend yet.</p>
        )}
        {(data ?? []).map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{c.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{c.id}</p>
            </div>
            <div className="flex items-center gap-2">
              {busyId === c.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Badge variant={c.pro ? "default" : "outline"}>{c.pro ? "Pro" : "Free"}</Badge>
              )}
              <Switch
                checked={c.pro}
                disabled={busyId !== null}
                onCheckedChange={(v) => setPro(c, v)}
                aria-label={`Toggle Pro for ${c.name}`}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
