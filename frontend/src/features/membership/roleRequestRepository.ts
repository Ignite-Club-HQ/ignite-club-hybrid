import { supabase } from "@/integrations/supabase/client";

/** Fresh, RLS-scoped reads: requesters need not already be club members. */
export async function listSupabaseRoleRequests(scope: { clubId: string } | { teamId: string }) {
  const column = "clubId" in scope ? "club_id" : "team_id";
  const id = "clubId" in scope ? scope.clubId : scope.teamId;
  const { data, error } = await supabase.from("role_requests")
    .select("*").eq(column, id).eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!data?.length) return [];
  const { data: profiles, error: profileError } = await supabase.from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", [...new Set(data.map(request => request.user_id))]);
  if (profileError) throw profileError;
  const byId = new Map((profiles ?? []).map(profile => [profile.id, profile]));
  return data.map(request => ({ ...request, requester: byId.get(request.user_id) ?? null }));
}