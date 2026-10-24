import { writeOnce } from "@/live/clubScope";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { createLiveFixture } from "@/live/features/competitions";
import {reserveFixtureIntent,clearFixtureIntent,readFixtureIntent} from "./fixtureRecovery";

export interface ManualMatchInput {
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  divisionId: string;
  scheduledAt: string;
  venue: string;
  pitch: string;
  round: string;
  duration: string;
  arrival: string;
  notes: string;
  createdBy?: string | null;
}

export interface ManualMatchRow {
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
  division_id: string | null;
  scheduled_at: string;
  venue: string;
  pitch_number: string | null;
  round_number: number | null;
  duration_minutes: number | null;
  arrival_minutes_before: number | null;
  notes: string | null;
  status: "scheduled";
  created_by: string | null;
}

export function buildManualMatchRow({
  competitionId,
  homeTeamId,
  awayTeamId,
  divisionId,
  scheduledAt,
  venue,
  pitch,
  round,
  duration,
  arrival,
  notes,
  createdBy,
}: ManualMatchInput): ManualMatchRow {
  return {
    competition_id: competitionId,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    division_id: divisionId || null,
    scheduled_at: new Date(scheduledAt).toISOString(),
    venue,
    pitch_number: pitch.trim() || null,
    round_number: round ? Number(round) : null,
    duration_minutes: duration ? Number(duration) : null,
    arrival_minutes_before: arrival ? Number(arrival) : null,
    notes: notes || null,
    status: "scheduled",
    created_by: createdBy ?? null,
  };
}

export async function createManualMatch(row: ManualMatchRow, operation = crypto.randomUUID()) {
  return withFeatureBackend("competitions", {
    supabase: async () => {
      const { error } = await supabase
        .from("competition_matches")
        .insert(row as never);
      return { error };
    },
    icp: async (ctx) => {
      try {
        const scope=[ctx.identity.getPrincipal().toText(),ctx.target.host,ctx.target.canisterIds.competition_domain,row.competition_id].join("|");
        const intent=reserveFixtureIntent(window.localStorage,scope,row,()=>operation);
        await createLiveFixture(ctx, intent.operation, row.competition_id, {
          homeTeamId: row.home_team_id, awayTeamId: row.away_team_id,
          divisionId: row.division_id, scheduledAtMs: new Date(row.scheduled_at),
          venue: row.venue, pitchNumber: row.pitch_number, roundNumber: row.round_number,
          durationMinutes: row.duration_minutes, arrivalMinutesBefore: row.arrival_minutes_before,
          notes: row.notes,
        });
        clearFixtureIntent(window.localStorage,scope);
        return { error: null };
      } catch (e) {
        return { error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  }, writeOnce({ competitionId: row.competition_id }));
}

export async function recoverManualMatch(competitionId:string) {
  return withFeatureBackend("competitions",{supabase:async()=>false,icp:async ctx=>{
    const scope=[ctx.identity.getPrincipal().toText(),ctx.target.host,ctx.target.canisterIds.competition_domain,competitionId].join("|");
    const intent=readFixtureIntent<ManualMatchRow>(window.localStorage,scope);if(!intent)return false;
    const [{connectLiveCompetitionDomain},{unwrapCandid}]=await Promise.all([import("@/live/domains"),import("@/live/features/candid")]);
    const {actor}=await connectLiveCompetitionDomain(ctx.target,ctx.identity);
    const found=await unwrapCandid(actor.read_fixture_operation(intent.operation),"Recover original fixture");
    if(found[0])await unwrapCandid(actor.materialize_match_events(found[0].match_id),"Recover fixture events");
    else {
      const r=intent.input;
      await createLiveFixture(ctx,intent.operation,competitionId,{homeTeamId:r.home_team_id,awayTeamId:r.away_team_id,divisionId:r.division_id,scheduledAtMs:new Date(r.scheduled_at),venue:r.venue,pitchNumber:r.pitch_number,roundNumber:r.round_number,durationMinutes:r.duration_minutes,arrivalMinutesBefore:r.arrival_minutes_before,notes:r.notes});
    }
    clearFixtureIntent(window.localStorage,scope);return true;
  }},{competitionId});
}
