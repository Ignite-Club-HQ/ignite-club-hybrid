import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { selectCachedProfileById } from "@/lib/profileCache";

type IgniteSupabaseClient = SupabaseClient<Database>;
type RoleRequestAction = "approve" | "deny";

type RoleRequestRecord = {
  user_id: string;
  role: string;
  team_id: string | null;
  club_id: string | null;
  teams: { id: string; name: string; club_id: string; clubs: { id: string; name: string; logo_url: string | null } | null } | null;
  clubs: { id: string; name: string; logo_url: string | null } | null;
};

type ProfileLookup = (userId: string) => Promise<{ data: { display_name?: string | null } | null }>;

export function friendlyRoleRequestError(error: unknown, action: RoleRequestAction): string {
  const detail = error as { message?: string; details?: string; hint?: string; code?: string } | null;
  const raw = [detail?.message, detail?.details, detail?.hint, detail?.code, String(error ?? "")]
    .filter(Boolean).join(" ").toLowerCase();
  const verb = action === "approve" ? "approve" : "deny";
  if (raw.includes("not authorized") || raw.includes("permission denied")) {
    return `You don't have permission to ${verb} this request. Only team admins, coaches, and club admins can manage join requests.`;
  }
  if (["already processed", "already approved", "already denied", "already handled", "not pending"].some((text) => raw.includes(text))) {
    const past = action === "approve" ? "approved" : "denied";
    return `This request has already been ${past} — likely by another admin. Pull to refresh to see the latest list.`;
  }
  if (raw.includes("request not found") || raw.includes("not found")) {
    return "This request no longer exists — it may have been withdrawn or already actioned.";
  }
  if (raw.includes("network") || raw.includes("failed to fetch") || raw.includes("timeout")) {
    return `We couldn't reach the server. Check your connection and try ${verb}ing again.`;
  }
  return `Couldn't ${verb} this request right now. Please try again in a moment — if it keeps failing, contact support.`;
}

export async function processRoleRequest(
  requestId: string,
  action: RoleRequestAction,
  client: IgniteSupabaseClient = supabase,
  profileLookup: ProfileLookup = selectCachedProfileById,
): Promise<void> {
  const { data, error: fetchError } = await client.from("role_requests").select(`
    *,
    teams:team_id(id, name, club_id, clubs:club_id(id, name, logo_url)),
    clubs:club_id(id, name, logo_url)
  `).eq("id", requestId).maybeSingle();
  if (fetchError || !data) throw new Error("Request not found");
  const request = data as unknown as RoleRequestRecord;

  const rpcName = action === "approve" ? "approve_role_request" : "deny_role_request";
  const { error } = await client.rpc(rpcName, { p_request_id: requestId });
  if (error) throw error;

  // The secure RPC is authoritative. Email is deliberately best-effort and
  // must never turn a completed approval/denial into an apparent failure.
  try {
    const teamName = request.teams?.name;
    const clubName = request.teams?.clubs?.name || request.clubs?.name || "the club";
    const clubLogoUrl = request.teams?.clubs?.logo_url || request.clubs?.logo_url;
    const entityName = teamName || clubName;
    const { data: profile } = await profileLookup(request.user_id);
    const { data: emails } = await client.rpc("get_user_emails_by_ids", { user_ids: [request.user_id] });
    const userEmail = emails?.[0]?.email;
    if (!userEmail) return;

    await client.functions.invoke("send-email", {
      body: {
        to: userEmail,
        subject: action === "approve"
          ? `Welcome to ${entityName}! 🎉`
          : `Update on your request to join ${entityName}`,
        template: "join-request-response",
        templateData: {
          recipientName: profile?.display_name || "Member",
          teamName,
          clubName,
          roleName: request.role.replace("_", " "),
          approved: action === "approve",
          ...(action === "approve" ? {
            teamLink: request.team_id ? `/teams/${request.team_id}` : `/clubs/${request.club_id}`,
          } : {}),
          clubLogoUrl,
        },
      },
    });
  } catch (sideEffectError) {
    console.warn(`[${action}Request] Email side-effect failed:`, sideEffectError);
  }
}
