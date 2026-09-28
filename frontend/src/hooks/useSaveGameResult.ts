import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { SummaryPlayerStat, PerQuarterScore } from "@/components/scoreboard/GameSummaryDialog";

/**
 * Cross-sport hook for persisting a completed game to `game_results`.
 * Designed for basketball + netball boards. Soccer keeps its own
 * `game_summaries` flow.
 */
export interface SaveGameResultInput {
  teamId: string;
  eventId?: string | null;
  sport: "basketball" | "netball" | "soccer";
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  perQuarter: PerQuarterScore[];
  players: SummaryPlayerStat[];
  mvpPlayerId?: string | null;
}

export function useSaveGameResult() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const savedKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const [saved, setSaved] = useState(false);

  const save = useCallback(
    async (
      input: SaveGameResultInput,
      opts?: { silent?: boolean; force?: boolean; onlyIfMissing?: boolean }
    ) => {
      // Include scores/opponent/MVP in the dedupe key (audit fix B11) so
      // post-game edits (rename opponent, set MVP, late score correction)
      // re-save instead of being silently swallowed.
      const key = [
        input.teamId,
        input.eventId ?? "no-event",
        input.sport,
        input.homeScore,
        input.awayScore,
        input.awayLabel,
        input.mvpPlayerId ?? "no-mvp",
      ].join(":");
      // De-dupe within a session, unless caller explicitly forces.
      if (!opts?.force && (savedKeyRef.current === key || inFlightRef.current)) return true;
      inFlightRef.current = true;

      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) return false;

        // Respect manual overrides: if a row already exists for this event,
        // skip the auto-write so user-edited scores/scorers aren't clobbered.
        if (opts?.onlyIfMissing && input.eventId) {
          const { data: existing, error: lookupError } = await supabase
            .from("game_results")
            .select("id")
            .eq("event_id", input.eventId)
            .maybeSingle();
          if (lookupError) {
            // Fail closed: we cannot confirm whether a manually edited result
            // already exists, so refuse the auto-write to avoid clobbering it.
            if (!opts?.silent) {
              const isPermission = /row-level security|permission/i.test(lookupError.message);
              toast({
                title: "Could not check existing result",
                description: isPermission
                  ? "Only team admins or coaches can save games."
                  : lookupError.message,
                variant: "destructive",
              });
            }
            return false;
          }
          if (existing?.id) {
            savedKeyRef.current = key;
            return true;
          }
        }


        const mvp = input.mvpPlayerId
          ? input.players.find((p) => p.id === input.mvpPlayerId)
          : null;

        const payload = {
          team_id: input.teamId,
          event_id: input.eventId ?? null,
          sport: input.sport,
          home_label: input.homeLabel,
          away_label: input.awayLabel,
          home_score: input.homeScore,
          away_score: input.awayScore,
          period_scores: input.perQuarter as any,
          player_stats: input.players as any,
          mvp_player_id: input.mvpPlayerId ?? null,
          mvp_player_name: mvp?.name ?? null,
          saved_by: uid,
        };

        const query = input.eventId
          ? supabase
              .from("game_results")
              .upsert(payload, { onConflict: "event_id" })
          : supabase.from("game_results").insert(payload);

        const { error } = await query;
        if (error) {
          if (!/row-level security/i.test(error.message)) {
            // eslint-disable-next-line no-console
            console.warn("[useSaveGameResult] insert failed", error);
          }
          if (!opts?.silent) {
            toast({
              title: "Could not save game",
              description: /row-level security/i.test(error.message)
                ? "Only team admins or coaches can save games."
                : error.message,
              variant: "destructive",
            });
          }
          return false;
        }

        savedKeyRef.current = key;
        setSaved(true);
        if (input.eventId) {
          queryClient.invalidateQueries({ queryKey: ["match-result", input.eventId] });
          queryClient.invalidateQueries({ queryKey: ["match-score", input.eventId] });
        }
        queryClient.invalidateQueries({ queryKey: ["team-game-events", input.teamId] });
        queryClient.invalidateQueries({ queryKey: ["player-stats-report-extras", input.teamId] });
        if (!opts?.silent) {
          toast({
            title: "Game saved",
            description: "Available in History on the team page.",
          });
        }
        return true;
      } finally {
        inFlightRef.current = false;
      }
    },
    [queryClient, toast]
  );

  return { save, saved };
}
