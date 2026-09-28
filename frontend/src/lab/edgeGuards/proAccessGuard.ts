/**
 * Local port of the sanitized Edge Function Pro-access guard
 * (`reference/backend/supabase/functions/_shared/proGuard.ts.md`).
 *
 * Provides `requireClubPro`, `requireTeamPro`, and `requireAnyClubPro`
 * helpers wrapping RPC-shaped entitlement lookups. All helpers return:
 *   - `null` when access is granted (RPC returned exactly `data === true`
 *     with no error).
 *   - A 400 Response when the required scope identifier is missing.
 *   - A 403 `{ error: "pro_required", ... }` Response when the RPC returns
 *     any other value.
 *   - A 500 `{ error: "pro_check_failed" }` Response when the RPC returns
 *     an error OR the underlying promise rejects. Fail-closed: entitlement
 *     is never granted when verification is unavailable.
 *
 * Internal error details (messages, stacks, URLs, tokens, DB internals) are
 * never surfaced to the client. This module has no Supabase, Deno, or
 * network dependency: the caller supplies an RPC-shaped client, satisfied in
 * the lab by a synthetic double.
 */

export type SupabaseRpcLike = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

function proCheckFailedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: 'pro_check_failed' }), {
    status: 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function proRequiredResponse(
  corsHeaders: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: 'pro_required', ...extra }), {
    status: 403,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function missingScopeResponse(corsHeaders: Record<string, string>, errorCode: string): Response {
  return new Response(JSON.stringify({ error: errorCode }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function requireClubPro(
  supabase: SupabaseRpcLike,
  clubId: string,
  corsHeaders: Record<string, string> = {},
): Promise<Response | null> {
  if (!clubId) return missingScopeResponse(corsHeaders, 'missing_club_id');
  try {
    const { data, error } = await supabase.rpc('has_active_pro_for_club', { _club_id: clubId });
    if (error) return proCheckFailedResponse(corsHeaders);
    if (data === true) return null;
    return proRequiredResponse(corsHeaders, { club_id: clubId });
  } catch {
    return proCheckFailedResponse(corsHeaders);
  }
}

export async function requireTeamPro(
  supabase: SupabaseRpcLike,
  teamId: string,
  corsHeaders: Record<string, string> = {},
): Promise<Response | null> {
  if (!teamId) return missingScopeResponse(corsHeaders, 'missing_team_id');
  try {
    const { data, error } = await supabase.rpc('has_active_pro_for_team', { _team_id: teamId });
    if (error) return proCheckFailedResponse(corsHeaders);
    if (data === true) return null;
    return proRequiredResponse(corsHeaders, { team_id: teamId });
  } catch {
    return proCheckFailedResponse(corsHeaders);
  }
}

export async function requireAnyClubPro(
  supabase: SupabaseRpcLike,
  userId: string,
  corsHeaders: Record<string, string> = {},
): Promise<Response | null> {
  if (!userId) return missingScopeResponse(corsHeaders, 'missing_user_id');
  try {
    const { data, error } = await supabase.rpc('user_has_any_club_pro', { _user_id: userId });
    if (error) return proCheckFailedResponse(corsHeaders);
    if (data === true) return null;
    return proRequiredResponse(corsHeaders);
  } catch {
    return proCheckFailedResponse(corsHeaders);
  }
}
