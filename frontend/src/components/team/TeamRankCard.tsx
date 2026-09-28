import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, TrendingUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface TeamRankCardProps {
  teamId: string;
  clubId: string;
}

interface LeaderboardRow {
  rank: number;
  team_id: string;
  team_name: string;
  points: number;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function TeamRankCard({ teamId, clubId }: TeamRankCardProps) {
  const [open, setOpen] = useState(false);

  const { data: leaderboard } = useQuery({
    queryKey: ["team-leaderboard-rank", clubId, teamId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_teams_leaderboard", {
        _club_id: clubId,
        _window: "all",
        _limit: 100,
      });
      if (error) throw error;
      return (data ?? []) as LeaderboardRow[];
    },
    enabled: !!clubId && !!teamId,
    staleTime: 5 * 60 * 1000,
  });

  if (!leaderboard) return null;
  const me = leaderboard.find((r) => r.team_id === teamId);
  if (!me) return null;

  const above = leaderboard.find((r) => r.rank === me.rank - 1);
  const below = leaderboard.find((r) => r.rank === me.rank + 1);
  const pointsToNext = above ? Math.max(0, above.points - me.points) : 0;
  const totalRanked = leaderboard.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg bg-muted/30">
      <div className="px-3 py-2.5 space-y-1">
        <Link
          to="/leaderboard"
          aria-label="View club participation rankings"
          className="block rounded-sm hover:bg-muted/40 -mx-1 px-1 py-0.5 transition-colors"
        >
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0 flex items-baseline gap-1.5">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Club Participation
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
              {me.rank <= 3 ? `#${me.rank}` : ordinal(me.rank)} of {totalRanked} teams
            </span>
          </div>

          {/* Primary motivator: nearby achievable goal */}
          {above && pointsToNext > 0 ? (
            <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
              <span>
                Only <span className="tabular-nums text-primary">{pointsToNext} pts</span> behind #{above.rank}
              </span>
            </div>
          ) : me.rank === 1 ? (
            <div className="mt-1 text-sm font-medium text-foreground">🏆 Top of the club</div>
          ) : (
            <div className="mt-1 text-sm font-medium text-foreground tabular-nums">{me.points} pts</div>
          )}
        </Link>

        <CollapsibleTrigger
          className="w-full flex items-center justify-between gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors pt-1"
          aria-label="Show how to earn participation points"
        >
          <span>Active teams climb the rankings</span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform shrink-0", open && "rotate-180")}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="px-3 pb-3 pt-0 space-y-3">
          {/* Nearby teams — social context */}
          {(above || below) && (
            <div className="rounded-md bg-background/60 border border-border/40 divide-y divide-border/40">
              {above && <NearbyRow row={above} />}
              <NearbyRow row={me} highlight />
              {below && <NearbyRow row={below} />}
            </div>
          )}

          {/* Earn tips — light + scannable */}
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-foreground">Earn points by:</p>
            <ul className="text-[11px] text-muted-foreground space-y-0.5">
              <li>✓ RSVPing early <span className="tabular-nums">(+3)</span></li>
              <li>✓ Posting in team chat <span className="tabular-nums">(+2)</span></li>
              <li>✓ Uploading team photos <span className="tabular-nums">(+3)</span></li>
            </ul>
            <p className="text-[10px] text-muted-foreground/70 pt-0.5">Daily caps apply.</p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function NearbyRow({ row, highlight = false }: { row: LeaderboardRow; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2.5 py-1.5 text-xs",
        highlight && "bg-primary/10",
      )}
    >
      <span
        className={cn(
          "tabular-nums w-7 text-[11px] shrink-0",
          highlight ? "font-bold text-primary" : "text-muted-foreground",
        )}
      >
        #{row.rank}
      </span>
      <span
        className={cn(
          "flex-1 min-w-0 truncate",
          highlight ? "font-semibold text-foreground" : "text-foreground/80",
        )}
      >
        {row.team_name}
      </span>
      <span
        className={cn(
          "tabular-nums text-[11px] shrink-0",
          highlight ? "font-semibold text-primary" : "text-muted-foreground",
        )}
      >
        {row.points} pts
      </span>
    </div>
  );
}
