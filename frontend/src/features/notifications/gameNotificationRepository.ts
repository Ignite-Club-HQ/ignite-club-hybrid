import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

function linkedEventId(pitchState: Json | null): string | null {
  if (!pitchState || Array.isArray(pitchState) || typeof pitchState !== "object") return null;
  const value = pitchState.linkedEventId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function resolveGameNotificationPath(
  gameId: string | null,
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  if (!gameId) return "/";
  const { data } = await client
    .from("active_games")
    .select("pitch_state")
    .eq("id", gameId)
    .maybeSingle();
  const eventId = linkedEventId(data?.pitch_state ?? null);
  return eventId ? `/events/${eventId}` : "/";
}
