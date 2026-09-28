import { Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// Football-only build: netball / basketball boards archived (see archive/sports/).
const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));

interface BoardViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameId: string;
}

interface LoadedGame {
  teamId: string;
  teamName: string;
  sport: string | null;
  members: Array<{
    id: string;
    user_id: string;
    role: string;
    profiles: { display_name: string | null; avatar_url: string | null } | null;
  }>;
}

/**
 * Read-only viewer for a shared live board. Loads the active_games row,
 * resolves its team + roster, and renders the pitch board with `readOnly`
 * so a viewer can't accidentally make changes.
 *
 * RLS on `active_games` already enforces team-member visibility, so if the
 * fetch returns nothing we show a friendly "no access" state.
 */
export function BoardViewerDialog({
  open,
  onOpenChange,
  gameId,
}: BoardViewerDialogProps) {
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !gameId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setGame(null);

    (async () => {
      const { data: row, error: rowErr } = await supabase
        .from("active_games")
        .select("team_id, teams(id, name, clubs!club_id(sport))")
        .eq("id", gameId)
        .maybeSingle();

      if (cancelled) return;
      if (rowErr || !row || !row.team_id) {
        setError("This board is no longer available.");
        setLoading(false);
        return;
      }

      const teamId = row.team_id;
      const team = (row as any).teams;
      const sport: string | null = team?.clubs?.sport ?? null;

      // Pull the team roster so the board can render player tokens by id.
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("id, user_id, role")
        .eq("team_id", teamId);

      const userIds = (roleRows ?? []).map((r: any) => r.user_id).filter(Boolean);
      let profilesMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
      if (userIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(userIds);
        for (const p of profiles ?? []) {
          profilesMap.set(p.id, {
            display_name: p.display_name,
            avatar_url: p.avatar_url,
          });
        }
      }

      const members = (roleRows ?? []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        role: r.role,
        profiles: profilesMap.get(r.user_id) ?? null,
      }));

      if (cancelled) return;
      setGame({
        teamId,
        teamName: team?.name ?? "Team",
        sport,
        members,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, gameId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!p-0 !gap-0 !w-screen !h-[100dvh] !max-w-none !rounded-none !border-0 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error || !game ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
            {error ?? "This board is no longer available."}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            }
          >
            <PitchBoard
              teamId={game.teamId}
              teamName={game.teamName}
              members={game.members}
              onClose={() => onOpenChange(false)}
              readOnly
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
