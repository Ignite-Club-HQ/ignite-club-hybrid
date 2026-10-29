import { supabase } from "@/integrations/supabase/client";

type EventInput = {
  operationId: string;
  competitionId: string;
  title: string;
  eventType: "social" | "training" | "game";
  startsAt: string;
  endsAt: string;
  location: string | null;
  description: string | null;
};

/** Only a PostgREST signature miss proves the first write never executed. */
export async function createSupabaseCompetitionEvent(input: EventInput) {
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown; error: { code?: string; message: string } | null;
  }>;
  let result = await rpc("create_competition_event", {
    p_operation_id: input.operationId,
    p_competition_id: input.competitionId,
    p_title: input.title,
    p_event_type: input.eventType,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_location: input.location,
    p_description: input.description,
  });
  if (result.error?.code === "PGRST202" && /\bcreate_competition_event\b/.test(result.error.message)) {
    result = await rpc("create_competition_event", {
      p_competition_id: input.competitionId,
      p_title: input.title,
      p_type: input.eventType,
      p_event_date: input.startsAt,
      p_end_time: input.endsAt,
      p_location: input.location,
      p_description: input.description,
    });
  }
  if (result.error) throw result.error;
  return result.data;
}